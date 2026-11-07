import { collections, newId, now } from "@/lib/db";
import type {
  BusinessDoc,
  ContactPointDoc,
  EvidenceRecordDoc,
  ScoreResultDoc,
  SourceRecordDoc,
} from "@/lib/db/types";
import { normalizeBusiness, nameTokens, type RawBusiness } from "@/lib/normalize";
import { findBestMatch, mergeBusinesses, recordDuplicateCandidate } from "@/lib/dedupe/service";
import { computeScore } from "@/lib/score/engine";
import { getActiveProfile, recalculateLeadScore } from "@/lib/score/service";
import type { ScoreConfig } from "@/lib/score/types";
import type { ColumnMapping, ImportField } from "./mapping";
import { publishEvent } from "@/lib/events/bus";

export interface IngestActor {
  workspaceId: string;
  userId: string | null;
  isDemo: boolean;
}

export interface IngestCounts {
  rowCount: number;
  validCount: number;
  newCount: number;
  duplicateCount: number;
  mergedCount: number;
  reviewCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface IngestOptions {
  actor: IngestActor;
  jobId: string;
  source: "import" | "osm" | "google_places" | "demo" | "manual";
  sourceLabel: string;
  mapping: ColumnMapping;
  fallbackPrefix: string;
  records: AsyncIterable<{
    rowNumber: number;
    sourceFile: string;
    record: Record<string, unknown>;
    raw: Record<string, unknown>;
  }>;
  totalHint?: number;
  onProgress?: (counts: IngestCounts, processed: number) => Promise<void>;
}

function pick(record: Record<string, unknown>, mapping: ColumnMapping, field: ImportField): unknown {
  const column = mapping[field];
  if (!column) return undefined;
  return record[column];
}

function applyMappingSafe(record: Record<string, unknown>, mapping: ColumnMapping): RawBusiness {
  const text = (field: ImportField): string | null => {
    const value = pick(record, mapping, field);
    if (value === null || value === undefined) return null;
    const stringValue = String(value).trim();
    return stringValue || null;
  };
  const numberValue = (field: ImportField): number | null => {
    const value = text(field);
    if (value === null) return null;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const lat = numberValue("lat");
  const lng = numberValue("lng");
  return {
    name: text("name") ?? "",
    category: text("category"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    street: text("street"),
    area: text("area"),
    city: text("city"),
    country: text("country"),
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
    lng: lng !== null && Math.abs(lng) <= 180 ? lng : null,
    sourceId: text("sourceId"),
  };
}

function payloadFor(raw: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const json = JSON.stringify(raw);
    if (json.length > 12_000) return null;
    return raw;
  } catch {
    return null;
  }
}

async function createLead(
  options: IngestOptions,
  rawRecord: RawBusiness,
  normalized: ReturnType<typeof normalizeBusiness>,
  sourceId: string,
  fallbackUrl: string,
  profile: { _id: string; version: number; config: ScoreConfig },
): Promise<string> {
  const { actor } = options;
  const timestamp = now();
  const businessId = newId();

  const business: BusinessDoc = {
    _id: businessId,
    workspaceId: actor.workspaceId,
    name: normalized.name,
    normalizedName: normalized.normalizedName,
    nameTokens: nameTokens(normalized.normalizedName),
    category: normalized.category,
    categoryKey: normalized.categoryKey,
    phone: rawRecord.phone ?? null,
    phoneE164: normalized.phone?.e164 ?? null,
    email: normalized.emailDisplay,
    emailNormalized: normalized.email,
    websiteUrl: normalized.website?.url ?? null,
    websiteHost: normalized.website?.host ?? null,
    street: normalized.street,
    area: normalized.area,
    city: normalized.city,
    country: normalized.country,
    lat: normalized.lat,
    lng: normalized.lng,
    status: "new",
    ownerId: actor.userId,
    doNotContact: false,
    followUpAt: null,
    notes: null,
    fieldLocks: [],
    latestScore: null,
    latestScoreResultId: null,
    latestScanId: null,
    latestScanOutcome: null,
    latestChatbotResult: null,
    lastCheckedAt: null,
    isDemo: actor.isDemo,
    hasWhatsapp: false,
    mergedIntoId: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await collections.businesses.insertOne(business);

  await collections.businessLocations.insertOne({
    _id: newId(),
    workspaceId: actor.workspaceId,
    businessId,
    street: normalized.street,
    area: normalized.area,
    city: normalized.city,
    country: normalized.country,
    lat: normalized.lat,
    lng: normalized.lng,
    formattedAddress: null,
    isPrimary: true,
    createdAt: timestamp,
  });

  const source: SourceRecordDoc = {
    _id: newId(),
    workspaceId: actor.workspaceId,
    businessId,
    source: options.source,
    sourceId,
    payload: payloadFor({ ...rawRecord }),
    attribution:
      options.source === "osm"
        ? "© OpenStreetMap contributors (ODbL)"
        : options.source === "google_places"
          ? "Google Places API"
          : options.sourceLabel,
    importJobId: options.jobId,
    createdAt: timestamp,
  };
  await collections.sourceRecords.insertOne(source);

  const contactValues: ContactPointDoc[] = [];
  const evidenceValues: EvidenceRecordDoc[] = [];

  if (normalized.email) {
    contactValues.push({
      _id: newId(),
      workspaceId: actor.workspaceId,
      businessId,
      type: "email",
      value: normalized.emailDisplay ?? normalized.email,
      normalizedValue: normalized.email,
      label: null,
      platform: null,
      verifiedByUser: false,
      confidence: "medium",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
    });
    evidenceValues.push({
      _id: newId(),
      workspaceId: actor.workspaceId,
      businessId,
      contactPointId: null,
      scanResultId: null,
      type: "email",
      originalValue: normalized.emailDisplay ?? normalized.email,
      normalizedValue: normalized.email,
      sourceUrl: fallbackUrl,
      method: "import",
      confidence: "medium",
      verificationStatus: "unverified",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    });
  }
  if (normalized.phone?.e164) {
    contactValues.push({
      _id: newId(),
      workspaceId: actor.workspaceId,
      businessId,
      type: "phone",
      value: rawRecord.phone ?? normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      label: normalized.phone.kind,
      platform: null,
      verifiedByUser: false,
      confidence: "medium",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
    });
    evidenceValues.push({
      _id: newId(),
      workspaceId: actor.workspaceId,
      businessId,
      contactPointId: null,
      scanResultId: null,
      type: "phone",
      originalValue: rawRecord.phone ?? normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      sourceUrl: fallbackUrl,
      method: "import",
      confidence: "medium",
      verificationStatus: "unverified",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    });
  } else if (rawRecord.phone) {
    contactValues.push({
      _id: newId(),
      workspaceId: actor.workspaceId,
      businessId,
      type: "phone",
      value: rawRecord.phone,
      normalizedValue: rawRecord.phone.replace(/[^\d+]/g, ""),
      label: "unknown",
      platform: null,
      verifiedByUser: false,
      confidence: "low",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
    });
  }

  for (const contact of contactValues) {
    await collections.contactPoints.updateOne(
      { businessId, type: contact.type, normalizedValue: contact.normalizedValue },
      { $setOnInsert: contact },
      { upsert: true },
    );
  }
  for (const evidence of evidenceValues) {
    await collections.evidenceRecords.updateOne(
      {
        businessId,
        type: evidence.type,
        originalValue: evidence.originalValue,
        sourceUrl: evidence.sourceUrl,
      },
      { $setOnInsert: evidence },
      { upsert: true },
    );
  }

  const score = computeScore(
    {
      categoryKey: normalized.categoryKey,
      scan: null,
      contacts: contactValues.map((contact) => ({
        type: contact.type,
        normalizedValue: contact.normalizedValue,
      })),
      hasExplicitWhatsapp: false,
      hasBooking: false,
      hasInquiryForm: false,
    },
    profile.config,
    { profileId: profile._id, profileVersion: profile.version },
  );

  const scoreRow: ScoreResultDoc = {
    _id: newId(),
    workspaceId: actor.workspaceId,
    businessId,
    profileId: profile._id,
    profileVersion: profile.version,
    total: score.total,
    components: score.components,
    calculatedAt: new Date(score.calculatedAt),
  };
  await collections.scoreResults.insertOne(scoreRow);

  await collections.businesses.updateOne(
    { workspaceId: actor.workspaceId, _id: businessId },
    { $set: { latestScore: score.total, latestScoreResultId: scoreRow._id } },
  );

  return businessId;
}

export async function ingestRecords(options: IngestOptions): Promise<IngestCounts> {
  const { actor, mapping } = options;
  const profile = await getActiveProfile(actor.workspaceId);
  const counts: IngestCounts = {
    rowCount: 0,
    validCount: 0,
    newCount: 0,
    duplicateCount: 0,
    mergedCount: 0,
    reviewCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };
  let processed = 0;

  for await (const item of options.records) {
    processed++;
    counts.rowCount++;
    const rawRecord = applyMappingSafe(item.record, mapping);
    const normalized = normalizeBusiness(rawRecord);

    if (!normalized.name || !normalized.normalizedName) {
      counts.skippedCount++;
      counts.errorCount++;
      await collections.importRowErrors.insertOne({
        _id: newId(),
        workspaceId: actor.workspaceId,
        importJobId: options.jobId,
        rowNumber: item.rowNumber,
        reason: `${item.sourceFile}: business name is missing or empty.`,
        raw: payloadFor(item.raw),
        createdAt: now(),
      });
    } else {
      counts.validCount++;
      const fallbackId = `${options.fallbackPrefix}:${item.sourceFile}:${item.rowNumber}`;
      const sourceId = rawRecord.sourceId?.slice(0, 300) ?? fallbackId;
      const fallbackUrl =
        options.source === "osm" || options.source === "google_places"
          ? `discovery://${options.source}/${encodeURIComponent(sourceId)}`
          : `import://${options.jobId}/${encodeURIComponent(item.sourceFile)}#row-${item.rowNumber}`;

      const existingSource = await collections.sourceRecords.findOne(
        {
          workspaceId: actor.workspaceId,
          source: options.source,
          sourceId,
        },
        { projection: { _id: 1 } },
      );

      if (existingSource) {
        counts.duplicateCount++;
      } else {
        const match = await findBestMatch(actor.workspaceId, {
          name: normalized.name,
          phoneE164: normalized.phone?.e164 ?? null,
          websiteHost: normalized.website?.host ?? null,
          street: normalized.street,
          lat: normalized.lat,
          lng: normalized.lng,
        });

        const businessId = await createLead(
          options,
          rawRecord,
          normalized,
          sourceId,
          fallbackUrl,
          profile,
        );

        if (match?.decision.action === "merge") {
          await mergeBusinesses(
            { workspaceId: actor.workspaceId, user: { id: actor.userId ?? "system" } },
            match.candidateId,
            businessId,
          );
          counts.mergedCount++;
        } else if (match?.decision.action === "review") {
          await recordDuplicateCandidate(
            actor.workspaceId,
            match.candidateId,
            businessId,
            match.decision,
          );
          counts.reviewCount++;
          counts.newCount++;
        } else {
          counts.newCount++;
        }
      }
    }

    if (processed % 50 === 0 || processed === options.totalHint) {
      await options.onProgress?.(counts, processed);
    }
  }

  await options.onProgress?.(counts, processed);
  return counts;
}

export async function finalizeImportJob(
  actor: IngestActor,
  jobId: string,
  counts: IngestCounts,
): Promise<void> {
  const finishedAt = now();
  await collections.importJobs.updateOne(
    { workspaceId: actor.workspaceId, _id: jobId },
    {
      $set: {
        status: "completed",
        progress: 100,
        processedRows: counts.rowCount,
        rowCount: counts.rowCount,
        validCount: counts.validCount,
        newCount: counts.newCount,
        duplicateCount: counts.duplicateCount,
        mergedCount: counts.mergedCount,
        reviewCount: counts.reviewCount,
        skippedCount: counts.skippedCount,
        errorCount: counts.errorCount,
        finishedAt,
      },
    },
  );

  await collections.activities.insertOne({
    _id: newId(),
    workspaceId: actor.workspaceId,
    businessId: null,
    type: "imported",
    message: `Import finished: ${counts.newCount} new, ${counts.mergedCount} merged, ${counts.duplicateCount} duplicates, ${counts.skippedCount} skipped`,
    metadata: { importJobId: jobId, ...counts },
    actorId: actor.userId,
    createdAt: finishedAt,
  });

  await publishEvent(actor.workspaceId, "import.completed", {
    importJobId: jobId,
    ...counts,
  });
}

export async function recalculateAfterMerge(workspaceId: string, businessId: string): Promise<void> {
  await recalculateLeadScore(workspaceId, businessId);
}
