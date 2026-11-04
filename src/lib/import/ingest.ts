import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  businesses,
  businessLocations,
  contactPoints,
  evidenceRecords,
  importJobs,
  importRowErrors,
  scoreResults,
  sourceRecords,
} from "@/lib/db/schema";
import { normalizeBusiness, type RawBusiness } from "@/lib/normalize";
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

function asRecord(value: RawBusiness): Record<string, unknown> {
  return { ...value };
}

async function createLead(
  options: IngestOptions,
  rawRecord: RawBusiness,
  normalized: ReturnType<typeof normalizeBusiness>,
  sourceId: string,
  fallbackUrl: string,
  profile: { id: string; version: number; config: ScoreConfig },
): Promise<string> {
  const { actor } = options;
  const [inserted] = await db
    .insert(businesses)
    .values({
      workspaceId: actor.workspaceId,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
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
      isDemo: actor.isDemo,
      ownerId: actor.userId,
    })
    .returning({ id: businesses.id });
  if (!inserted) throw new Error("Could not create the business row.");

  const businessId = inserted.id;

  await db.insert(businessLocations).values({
    workspaceId: actor.workspaceId,
    businessId,
    street: normalized.street,
    area: normalized.area,
    city: normalized.city,
    country: normalized.country,
    lat: normalized.lat,
    lng: normalized.lng,
    isPrimary: true,
  });

  await db.insert(sourceRecords).values({
    workspaceId: actor.workspaceId,
    businessId,
    source: options.source,
    sourceId,
    payload: payloadFor(asRecord(rawRecord)),
    attribution:
      options.source === "osm"
        ? "© OpenStreetMap contributors (ODbL)"
        : options.source === "google_places"
          ? "Google Places API"
          : options.sourceLabel,
    importJobId: options.jobId,
  });

  const contactValues: Array<typeof contactPoints.$inferInsert> = [];
  const evidenceValues: Array<Omit<typeof evidenceRecords.$inferInsert, "workspaceId" | "businessId">> = [];

  if (normalized.email) {
    contactValues.push({
      workspaceId: actor.workspaceId,
      businessId,
      type: "email",
      value: normalized.emailDisplay ?? normalized.email,
      normalizedValue: normalized.email,
      confidence: "medium",
    });
    evidenceValues.push({
      type: "email",
      originalValue: normalized.emailDisplay ?? normalized.email,
      normalizedValue: normalized.email,
      sourceUrl: fallbackUrl,
      method: "import",
      confidence: "medium",
      verificationStatus: "unverified",
    });
  }
  if (normalized.phone?.e164) {
    contactValues.push({
      workspaceId: actor.workspaceId,
      businessId,
      type: "phone",
      value: rawRecord.phone ?? normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      label: normalized.phone.kind,
      confidence: "medium",
    });
    evidenceValues.push({
      type: "phone",
      originalValue: rawRecord.phone ?? normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      sourceUrl: fallbackUrl,
      method: "import",
      confidence: "medium",
      verificationStatus: "unverified",
    });
  } else if (rawRecord.phone) {
    contactValues.push({
      workspaceId: actor.workspaceId,
      businessId,
      type: "phone",
      value: rawRecord.phone,
      normalizedValue: rawRecord.phone.replace(/[^\d+]/g, ""),
      label: "unknown",
      confidence: "low",
    });
  }

  if (contactValues.length) {
    await db.insert(contactPoints).values(contactValues).onConflictDoNothing();
  }
  if (evidenceValues.length) {
    await db
      .insert(evidenceRecords)
      .values(evidenceValues.map((value) => ({ ...value, workspaceId: actor.workspaceId, businessId })))
      .onConflictDoNothing();
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
    { profileId: profile.id, profileVersion: profile.version },
  );

  const [scoreRow] = await db
    .insert(scoreResults)
    .values({
      workspaceId: actor.workspaceId,
      businessId,
      profileId: profile.id,
      profileVersion: profile.version,
      total: score.total,
      components: score.components,
    })
    .returning({ id: scoreResults.id });

  if (scoreRow) {
    await db
      .update(businesses)
      .set({ latestScore: score.total, latestScoreResultId: scoreRow.id })
      .where(and(eq(businesses.workspaceId, actor.workspaceId), eq(businesses.id, businessId)));
  }

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
      await db.insert(importRowErrors).values({
        workspaceId: actor.workspaceId,
        importJobId: options.jobId,
        rowNumber: item.rowNumber,
        reason: `${item.sourceFile}: business name is missing or empty.`,
        raw: payloadFor(item.raw),
      });
    } else {
      counts.validCount++;
      const fallbackId = `${options.fallbackPrefix}:${item.sourceFile}:${item.rowNumber}`;
      const sourceId = rawRecord.sourceId?.slice(0, 300) ?? fallbackId;
      const fallbackUrl =
        options.source === "osm" || options.source === "google_places"
          ? `discovery://${options.source}/${encodeURIComponent(sourceId)}`
          : `import://${options.jobId}/${encodeURIComponent(item.sourceFile)}#row-${item.rowNumber}`;

      const [existingSource] = await db
        .select({ id: sourceRecords.id })
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.workspaceId, actor.workspaceId),
            eq(sourceRecords.source, options.source),
            eq(sourceRecords.sourceId, sourceId),
          ),
        )
        .limit(1);

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
  await db
    .update(importJobs)
    .set({
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
      finishedAt: new Date(),
    })
    .where(and(eq(importJobs.workspaceId, actor.workspaceId), eq(importJobs.id, jobId)));

  await db.insert(activities).values({
    workspaceId: actor.workspaceId,
    businessId: null,
    type: "imported",
    message: `Import finished: ${counts.newCount} new, ${counts.mergedCount} merged, ${counts.duplicateCount} duplicates, ${counts.skippedCount} skipped`,
    metadata: { importJobId: jobId, ...counts },
    actorId: actor.userId,
  });

  await publishEvent(actor.workspaceId, "import.completed", {
    importJobId: jobId,
    ...counts,
  });
}

export async function recalculateAfterMerge(workspaceId: string, businessId: string): Promise<void> {
  await recalculateLeadScore(workspaceId, businessId);
}
