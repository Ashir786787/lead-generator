import { and, eq } from "drizzle-orm";
import { api } from "@/lib/api/errors";
import type { WorkspaceContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  activities,
  businesses,
  businessLocations,
  businessTags,
  categoryMappings,
  contactPoints,
  evidenceRecords,
  sourceRecords,
  tags,
} from "@/lib/db/schema";
import { findBestMatch, mergeBusinesses, recordDuplicateCandidate } from "@/lib/dedupe/service";
import { normalizeBusiness } from "@/lib/normalize";
import { recalculateLeadScore } from "@/lib/score/service";
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
  const rows = await db
    .select({ pattern: categoryMappings.rawPattern, key: categoryMappings.categoryKey })
    .from(categoryMappings)
    .where(eq(categoryMappings.workspaceId, workspaceId));
  const overrides: Record<string, CategoryKey> = {};
  for (const row of rows) overrides[row.pattern.toLowerCase()] = row.key as CategoryKey;
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

  const [inserted] = await db
    .insert(businesses)
    .values({
      workspaceId: ctx.workspaceId,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
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
      doNotContact: Boolean(input.doNotContact),
      notes: input.notes?.trim() || null,
      followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
      ownerId: input.ownerId ?? ctx.user.id,
      isDemo: ctx.isDemo,
    })
    .returning({ id: businesses.id });
  if (!inserted) throw api.conflict("Could not create the lead.");

  const businessId = inserted.id;
  const sourceId = `manual:${businessId}`;
  const fallbackUrl = `manual://${ctx.workspaceId}/${businessId}`;

  await db.insert(businessLocations).values({
    workspaceId: ctx.workspaceId,
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
    workspaceId: ctx.workspaceId,
    businessId,
    source: "manual",
    sourceId,
    payload: { enteredBy: ctx.user.id, createdAt: new Date().toISOString() },
    attribution: "Entered manually in Lead Finder",
  });

  const contactValues: Array<typeof contactPoints.$inferInsert> = [];
  const evidenceValues: Array<Omit<typeof evidenceRecords.$inferInsert, "workspaceId" | "businessId">> = [];

  if (normalized.email) {
    contactValues.push({
      workspaceId: ctx.workspaceId,
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
      method: "manual-entry",
      confidence: "medium",
      verificationStatus: "unverified",
    });
  }
  if (normalized.phone?.e164) {
    contactValues.push({
      workspaceId: ctx.workspaceId,
      businessId,
      type: "phone",
      value: input.phone?.trim() || normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      label: normalized.phone.kind,
      confidence: "medium",
    });
    evidenceValues.push({
      type: "phone",
      originalValue: input.phone?.trim() || normalized.phone.e164,
      normalizedValue: normalized.phone.e164,
      sourceUrl: fallbackUrl,
      method: "manual-entry",
      confidence: "medium",
      verificationStatus: "unverified",
    });
  }

  if (contactValues.length) await db.insert(contactPoints).values(contactValues).onConflictDoNothing();
  if (evidenceValues.length) {
    await db
      .insert(evidenceRecords)
      .values(evidenceValues.map((value) => ({ ...value, workspaceId: ctx.workspaceId, businessId })))
      .onConflictDoNothing();
  }

  if (input.tags?.length) {
    const names = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    for (const name of names) {
      await db
        .insert(tags)
        .values({ workspaceId: ctx.workspaceId, name })
        .onConflictDoNothing({ target: [tags.workspaceId, tags.name] });
      const [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.workspaceId, ctx.workspaceId), eq(tags.name, name)))
        .limit(1);
      if (tag) {
        await db
          .insert(businessTags)
          .values({ workspaceId: ctx.workspaceId, businessId, tagId: tag.id })
          .onConflictDoNothing();
      }
    }
  }

  await db.insert(activities).values({
    workspaceId: ctx.workspaceId,
    businessId,
    type: "created",
    message: "Lead created manually",
    actorId: ctx.user.id,
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
