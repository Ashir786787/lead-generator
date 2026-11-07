import { api } from "@/lib/api/errors";
import type { WorkspaceContext } from "@/lib/auth/session";
import { collections, newId, now } from "@/lib/db";
import type { BusinessDoc, ContactPointDoc, EvidenceRecordDoc } from "@/lib/db/types";
import { findBestMatch, mergeBusinesses, recordDuplicateCandidate } from "@/lib/dedupe/service";
import { normalizeBusiness, nameTokens } from "@/lib/normalize";
import { recalculateLeadScore } from "@/lib/score/service";
import { ensureTag, linkTag } from "@/lib/data/tags";
import type { CategoryKey } from "@/lib/score/types";
import type { PipelineStatus } from "@/lib/constants";
import { publishEvent } from "@/lib/events/bus";

export interface ManualLeadInput {
  name: string;
  category?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  area?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: PipelineStatus;
  notes?: string | null;
  followUpAt?: string | null;
  ownerId?: string | null;
  doNotContact?: boolean;
  tags?: string[];
}

export interface ManualLeadResult {
  businessId: string;
  mergedIntoId: string | null;
  reviewQueued: boolean;
}

async function categoryOverrides(workspaceId: string): Promise<Record<string, CategoryKey>> {
  const rows = await collections.categoryMappings
    .find({ workspaceId }, { projection: { rawPattern: 1, categoryKey: 1 } })
    .toArray();
  const overrides: Record<string, CategoryKey> = {};
  for (const row of rows) overrides[row.rawPattern.toLowerCase()] = row.categoryKey as CategoryKey;
  return overrides;
}

/**
 * Create a single lead by hand. Uses exactly the same normalisation, duplicate
 * policy and scoring as imported records — no synthetic fields are invented.
 */
export async function createManualLead(
  ctx: WorkspaceContext,
  input: ManualLeadInput,
): Promise<ManualLeadResult> {
  const overrides = await categoryOverrides(ctx.workspaceId);
  const normalized = normalizeBusiness(
    {
      name: input.name,
      category: input.category,
      website: input.website,
      phone: input.phone,
      email: input.email,
      street: input.street,
      area: input.area,
      city: input.city,
      country: input.country,
      lat: input.lat,
      lng: input.lng,
    },
    { categoryOverrides: overrides },
  );

  if (!normalized.normalizedName) {
    throw api.badRequest("Enter the business name.");
  }
  if (input.website?.trim() && !normalized.website) {
    throw api.badRequest("Enter a public http(s) website such as https://example.com.");
  }
  if (input.email?.trim() && !normalized.email) {
    throw api.badRequest("That email address does not look valid.");
  }

  const match = await findBestMatch(ctx.workspaceId, {
    name: normalized.name,
    phoneE164: normalized.phone?.e164 ?? null,
    websiteHost: normalized.website?.host ?? null,
    street: normalized.street,
    lat: normalized.lat,
    lng: normalized.lng,
  });

  const timestamp = now();
  const businessId = newId();
  const business: BusinessDoc = {
    _id: businessId,
    workspaceId: ctx.workspaceId,
    name: normalized.name,
    normalizedName: normalized.normalizedName,
    nameTokens: nameTokens(normalized.normalizedName),
    category: normalized.category,
    categoryKey: normalized.categoryKey,
    phone: input.phone?.trim() || null,
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
    status: input.doNotContact ? "do_not_contact" : input.status ?? "new",
    ownerId: input.ownerId ?? ctx.user.id,
    doNotContact: Boolean(input.doNotContact),
    followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
    notes: input.notes?.trim() || null,
    fieldLocks: [],
    latestScore: null,
    latestScoreResultId: null,
    latestScanId: null,
    latestScanOutcome: null,
    latestChatbotResult: null,
    lastCheckedAt: null,
    isDemo: ctx.isDemo,
    hasWhatsapp: false,
    mergedIntoId: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await collections.businesses.insertOne(business);

  const sourceId = `manual:${businessId}`;
  const fallbackUrl = `manual://${ctx.workspaceId}/${businessId}`;

  await collections.businessLocations.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
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

  await collections.sourceRecords.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
    businessId,
    source: "manual",
    sourceId,
    payload: { enteredBy: ctx.user.id, createdAt: timestamp.toISOString() },
    attribution: "Entered manually in Lead Finder",
    importJobId: null,
    createdAt: timestamp,
  });

  const contactValues: ContactPointDoc[] = [];
  const evidenceValues: EvidenceRecordDoc[] = [];

  if (normalized.email) {
    contactValues.push({
      _id: newId(),
      workspaceId: ctx.workspaceId,
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
      workspaceId: ctx.workspaceId,
      businessId,
      contactPointId: null,
      scanResultId: null,
      type: "email",
      originalValue: normalized.emailDisplay ?? normalized.email,
      normalizedValue: normalized.email,
      sourceUrl: fallbackUrl,
      method: "manual-entry",
      confidence: "medium",
      verificationStatus: "unverified",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    });
  }
  if (normalized.phone?.e164) {
    contactValues.push({
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId,
      type: "phone",
      value: input.phone?.trim() || normalized.phone.e164,
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
      workspaceId: ctx.workspaceId,
      businessId,
      contactPointId: null,
      scanResultId: null,
      type: "phone",
      originalValue: input.phone?.trim() || normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      sourceUrl: fallbackUrl,
      method: "manual-entry",
      confidence: "medium",
      verificationStatus: "unverified",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
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

  if (input.tags?.length) {
    const names = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    for (const name of names) {
      const tagId = await ensureTag(ctx.workspaceId, name);
      await linkTag(ctx.workspaceId, businessId, tagId);
    }
  }

  await collections.activities.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
    businessId,
    type: "created",
    message: "Lead created manually",
    metadata: null,
    actorId: ctx.user.id,
    createdAt: timestamp,
  });

  if (match?.decision.action === "merge") {
    await mergeBusinesses(ctx, match.candidateId, businessId);
    await publishEvent(ctx.workspaceId, "lead.created", { businessId: match.candidateId, merged: true });
    return { businessId: match.candidateId, mergedIntoId: match.candidateId, reviewQueued: false };
  }

  if (match?.decision.action === "review") {
    await recordDuplicateCandidate(ctx.workspaceId, match.candidateId, businessId, match.decision);
  }

  await recalculateLeadScore(ctx.workspaceId, businessId);
  await publishEvent(ctx.workspaceId, "lead.created", { businessId });
  return { businessId, mergedIntoId: null, reviewQueued: match?.decision.action === "review" };
}
