import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  activities,
  businesses,
  businessTags,
  contactPoints,
  duplicateCandidates,
  evidenceRecords,
  mergeHistory,
  notes,
  sourceRecords,
} from "@/lib/db/schema";
import type { ActorContext } from "@/lib/data/types";
import { decideDuplicate, type DedupeDecision, type DedupeRecord } from "./decide";
import { recalculateLeadScore } from "@/lib/score/service";
import { publishEvent } from "@/lib/events/bus";
import { notFound, conflict } from "@/lib/api/errors";

export interface MatchResult {
  candidateId: string;
  decision: DedupeDecision;
}

function toRecord(row: {
  name: string;
  phoneE164: string | null;
  websiteHost: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;
}): DedupeRecord {
  return {
    name: row.name,
    phoneE164: row.phoneE164,
    websiteHost: row.websiteHost,
    street: row.street,
    lat: row.lat,
    lng: row.lng,
  };
}

export async function findBestMatch(
  workspaceId: string,
  incoming: DedupeRecord,
  excludeBusinessId?: string,
): Promise<MatchResult | null> {
  const hostVariants = new Set<string>();
  if (incoming.websiteHost) {
    const host = incoming.websiteHost.replace(/^www\./, "");
    hostVariants.add(host);
    hostVariants.add(`www.${host}`);
  }

  const signals = [];
  if (incoming.phoneE164) signals.push(eq(businesses.phoneE164, incoming.phoneE164));
  if (hostVariants.size) signals.push(inArray(businesses.websiteHost, [...hostVariants]));
  if (incoming.name) {
    signals.push(sql`similarity(${businesses.normalizedName}, ${incoming.name}) > 0.45`);
  }
  if (!signals.length) return null;

  const conditions = [
    eq(businesses.workspaceId, workspaceId),
    isNull(businesses.mergedIntoId),
    or(...signals),
  ];
  if (excludeBusinessId) conditions.push(sql`${businesses.id} <> ${excludeBusinessId}`);

  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      phoneE164: businesses.phoneE164,
      websiteHost: businesses.websiteHost,
      street: businesses.street,
      lat: businesses.lat,
      lng: businesses.lng,
    })
    .from(businesses)
    .where(and(...conditions))
    .orderBy(sql`similarity(${businesses.normalizedName}, ${incoming.name}) desc`)
    .limit(25);

  let bestMerge: MatchResult | null = null;
  let bestReview: MatchResult | null = null;
  for (const row of rows) {
    const decision = decideDuplicate(incoming, toRecord(row));
    if (decision.action === "merge" && (!bestMerge || decision.similarity > bestMerge.decision.similarity)) {
      bestMerge = { candidateId: row.id, decision };
    }
    if (decision.action === "review" && (!bestReview || decision.similarity > bestReview.decision.similarity)) {
      bestReview = { candidateId: row.id, decision };
    }
  }
  return bestMerge ?? bestReview;
}

export async function recordDuplicateCandidate(
  workspaceId: string,
  businessAId: string,
  businessBId: string,
  decision: DedupeDecision,
): Promise<void> {
  const [left, right] = [businessAId, businessBId].sort();
  await db
    .insert(duplicateCandidates)
    .values({
      workspaceId,
      businessAId: left,
      businessBId: right,
      similarity: decision.similarity,
      distanceM: decision.distanceM,
      reasons: [decision.reason],
      status: "pending",
    })
    .onConflictDoNothing();
  await publishEvent(workspaceId, "duplicate.detected", { businessId: right });
}

interface SerializedBusiness {
  [key: string]: unknown;
}

interface MergeSnapshot {
  business: SerializedBusiness;
  filledFields: string[];
  keptBefore: {
    contactIds: string[];
    sourceIds: string[];
    evidenceIds: string[];
    noteIds: string[];
    activityIds: string[];
    tagIds: string[];
  };
  merged: {
    contacts: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    noteIds: string[];
    activityIds: string[];
    tagIds: string[];
  };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Merge `mergedId` into `keptId`. Notes, status, follow-ups, locks and all source
 * references survive. The merged row is retained (archived) so undo is possible.
 */
export async function mergeBusinesses(
  ctx: ActorContext,
  keptId: string,
  mergedId: string,
): Promise<{ keptId: string; mergedId: string; mergeId: string }> {
  if (keptId === mergedId) throw conflict("Cannot merge a business with itself.");

  const mergeId = await db.transaction(async (tx) => {
    const [kept] = await tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, keptId)))
      .for("update");
    const [merged] = await tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, mergedId)))
      .for("update");
    if (!kept || !merged) throw notFound("One of the businesses was not found.");
    if (merged.mergedIntoId) throw conflict("That business has already been merged.");

    const keptContacts = await tx
      .select()
      .from(contactPoints)
      .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.businessId, keptId)));
    const mergedContacts = await tx
      .select()
      .from(contactPoints)
      .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.businessId, mergedId)));
    const keptSources = await tx
      .select()
      .from(sourceRecords)
      .where(and(eq(sourceRecords.workspaceId, ctx.workspaceId), eq(sourceRecords.businessId, keptId)));
    const mergedSources = await tx
      .select()
      .from(sourceRecords)
      .where(and(eq(sourceRecords.workspaceId, ctx.workspaceId), eq(sourceRecords.businessId, mergedId)));
    const keptEvidence = await tx
      .select()
      .from(evidenceRecords)
      .where(and(eq(evidenceRecords.workspaceId, ctx.workspaceId), eq(evidenceRecords.businessId, keptId)));
    const mergedEvidence = await tx
      .select()
      .from(evidenceRecords)
      .where(and(eq(evidenceRecords.workspaceId, ctx.workspaceId), eq(evidenceRecords.businessId, mergedId)));
    const keptNotes = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.workspaceId, ctx.workspaceId), eq(notes.businessId, keptId)));
    const mergedNotes = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.workspaceId, ctx.workspaceId), eq(notes.businessId, mergedId)));
    const keptActivities = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.businessId, keptId)));
    const mergedActivities = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.businessId, mergedId)));
    const keptTags = await tx
      .select({ tagId: businessTags.tagId })
      .from(businessTags)
      .where(and(eq(businessTags.workspaceId, ctx.workspaceId), eq(businessTags.businessId, keptId)));
    const mergedTags = await tx
      .select({ tagId: businessTags.tagId })
      .from(businessTags)
      .where(and(eq(businessTags.workspaceId, ctx.workspaceId), eq(businessTags.businessId, mergedId)));

    const locked = new Set(kept.fieldLocks ?? []);
    const filledFields: string[] = [];
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = [
      "phone",
      "phoneE164",
      "email",
      "emailNormalized",
      "websiteUrl",
      "websiteHost",
      "street",
      "area",
      "city",
      "country",
      "lat",
      "lng",
      "category",
      "categoryKey",
    ] as const;
    const keptRecord = kept as unknown as Record<string, unknown>;
    const mergedRecord = merged as unknown as Record<string, unknown>;
    for (const field of fields) {
      const current = keptRecord[field];
      const incoming = mergedRecord[field];
      if ((current === null || current === undefined || current === "") && incoming != null && !locked.has(field)) {
        updates[field] = incoming;
        filledFields.push(field);
      }
    }
    if (
      merged.lastCheckedAt &&
      (!kept.lastCheckedAt || merged.lastCheckedAt > kept.lastCheckedAt)
    ) {
      updates.latestScanId = merged.latestScanId;
      updates.latestScanOutcome = merged.latestScanOutcome;
      updates.latestChatbotResult = merged.latestChatbotResult;
      updates.lastCheckedAt = merged.lastCheckedAt;
    }

    await tx
      .update(businesses)
      .set(updates)
      .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, keptId)));

    for (const contact of mergedContacts) {
      await tx
        .insert(contactPoints)
        .values({
          workspaceId: ctx.workspaceId,
          businessId: keptId,
          type: contact.type,
          value: contact.value,
          normalizedValue: contact.normalizedValue,
          label: contact.label,
          platform: contact.platform,
          verifiedByUser: contact.verifiedByUser,
          confidence: contact.confidence,
          firstSeenAt: contact.firstSeenAt,
          lastSeenAt: contact.lastSeenAt,
        })
        .onConflictDoUpdate({
          target: [contactPoints.businessId, contactPoints.type, contactPoints.normalizedValue],
          set: {
            lastSeenAt: sql`greatest(${contactPoints.lastSeenAt}, excluded.last_seen_at)`,
            verifiedByUser: sql`${contactPoints.verifiedByUser} or excluded.verified_by_user`,
          },
        });
    }
    if (mergedContacts.length) {
      await tx
        .delete(contactPoints)
        .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.businessId, mergedId)));
    }

    for (const evidence of mergedEvidence) {
      await tx
        .insert(evidenceRecords)
        .values({
          workspaceId: ctx.workspaceId,
          businessId: keptId,
          type: evidence.type,
          originalValue: evidence.originalValue,
          normalizedValue: evidence.normalizedValue,
          sourceUrl: evidence.sourceUrl,
          method: evidence.method,
          confidence: evidence.confidence,
          verificationStatus: evidence.verificationStatus,
          firstSeenAt: evidence.firstSeenAt,
          lastSeenAt: evidence.lastSeenAt,
        })
        .onConflictDoNothing();
    }
    if (mergedEvidence.length) {
      await tx
        .delete(evidenceRecords)
        .where(and(eq(evidenceRecords.workspaceId, ctx.workspaceId), eq(evidenceRecords.businessId, mergedId)));
    }

    for (const source of mergedSources) {
      const duplicate = keptSources.find(
        (existing) => existing.source === source.source && existing.sourceId === source.sourceId,
      );
      if (duplicate) {
        await tx.delete(sourceRecords).where(eq(sourceRecords.id, source.id));
      } else {
        await tx.update(sourceRecords).set({ businessId: keptId }).where(eq(sourceRecords.id, source.id));
      }
    }

    if (mergedNotes.length) {
      await tx
        .update(notes)
        .set({ businessId: keptId })
        .where(and(eq(notes.workspaceId, ctx.workspaceId), eq(notes.businessId, mergedId)));
    }
    if (mergedActivities.length) {
      await tx
        .update(activities)
        .set({ businessId: keptId })
        .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.businessId, mergedId)));
    }

    if (mergedTags.length) {
      await tx
        .insert(businessTags)
        .values(mergedTags.map((tag) => ({ workspaceId: ctx.workspaceId, businessId: keptId, tagId: tag.tagId })))
        .onConflictDoNothing();
      await tx
        .delete(businessTags)
        .where(and(eq(businessTags.workspaceId, ctx.workspaceId), eq(businessTags.businessId, mergedId)));
    }

    await tx
      .update(businesses)
      .set({ mergedIntoId: keptId, archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, mergedId)));

    await tx
      .update(duplicateCandidates)
      .set({ status: "merged", resolvedAt: new Date(), resolvedBy: ctx.user.id })
      .where(
        and(
          eq(duplicateCandidates.workspaceId, ctx.workspaceId),
          eq(duplicateCandidates.status, "pending"),
          or(
            eq(duplicateCandidates.businessAId, mergedId),
            eq(duplicateCandidates.businessBId, mergedId),
          ),
        ),
      );

    const snapshot: MergeSnapshot = {
      business: JSON.parse(JSON.stringify(merged)),
      filledFields,
      keptBefore: {
        contactIds: keptContacts.map((row) => row.id),
        sourceIds: keptSources.map((row) => row.id),
        evidenceIds: keptEvidence.map((row) => row.id),
        noteIds: keptNotes.map((row) => row.id),
        activityIds: keptActivities.map((row) => row.id),
        tagIds: keptTags.map((row) => row.tagId),
      },
      merged: {
        contacts: mergedContacts.map((row) => ({ ...row, firstSeenAt: iso(row.firstSeenAt), lastSeenAt: iso(row.lastSeenAt), createdAt: iso(row.createdAt) })),
        sources: mergedSources.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
        evidence: mergedEvidence.map((row) => ({ ...row, firstSeenAt: iso(row.firstSeenAt), lastSeenAt: iso(row.lastSeenAt) })),
        noteIds: mergedNotes.map((row) => row.id),
        activityIds: mergedActivities.map((row) => row.id),
        tagIds: mergedTags.map((row) => row.tagId),
      },
    };

    const [history] = await tx
      .insert(mergeHistory)
      .values({
        workspaceId: ctx.workspaceId,
        keptBusinessId: keptId,
        mergedBusinessId: mergedId,
        snapshot: snapshot as unknown as Record<string, unknown>,
        actorId: ctx.user.id,
      })
      .returning({ id: mergeHistory.id });

    await tx.insert(activities).values({
      workspaceId: ctx.workspaceId,
      businessId: keptId,
      type: "merged",
      message: `Merged duplicate “${merged.name}” into this lead`,
      actorId: ctx.user.id,
      metadata: { mergedBusinessId: mergedId },
    });

    if (!history) throw new Error("Could not write merge history.");
    return history.id;
  });

  await recalculateLeadScore(ctx.workspaceId, keptId);
  await publishEvent(ctx.workspaceId, "duplicates.resolved", { businessId: keptId, action: "merged" });
  await publishEvent(ctx.workspaceId, "lead.updated", { businessId: keptId });
  return { keptId, mergedId, mergeId };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function undoLastMerge(ctx: ActorContext): Promise<{ mergeId: string } | null> {
  const [history] = await db
    .select()
    .from(mergeHistory)
    .where(and(eq(mergeHistory.workspaceId, ctx.workspaceId), isNull(mergeHistory.undoneAt)))
    .orderBy(desc(mergeHistory.createdAt))
    .limit(1);
  if (!history) return null;

  const snapshot = history.snapshot as unknown as MergeSnapshot;

  await db.transaction(async (tx) => {
    const mergedId = history.mergedBusinessId;
    const keptId = history.keptBusinessId;
    const business = snapshot.business as Record<string, unknown>;

    await tx
      .update(businesses)
      .set({
        mergedIntoId: null,
        archivedAt: null,
        name: String(business.name ?? ""),
        normalizedName: String(business.normalizedName ?? ""),
        category: (business.category as string | null) ?? null,
        categoryKey: (business.categoryKey as string | null) ?? null,
        phone: (business.phone as string | null) ?? null,
        phoneE164: (business.phoneE164 as string | null) ?? null,
        email: (business.email as string | null) ?? null,
        emailNormalized: (business.emailNormalized as string | null) ?? null,
        websiteUrl: (business.websiteUrl as string | null) ?? null,
        websiteHost: (business.websiteHost as string | null) ?? null,
        street: (business.street as string | null) ?? null,
        area: (business.area as string | null) ?? null,
        city: (business.city as string | null) ?? null,
        country: (business.country as string | null) ?? null,
        lat: (business.lat as number | null) ?? null,
        lng: (business.lng as number | null) ?? null,
        status: business.status as typeof businesses.$inferInsert.status,
        notes: (business.notes as string | null) ?? null,
        followUpAt: toDate(business.followUpAt),
        ownerId: (business.ownerId as string | null) ?? null,
        doNotContact: Boolean(business.doNotContact),
        updatedAt: new Date(),
      })
      .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, mergedId)));

    for (const raw of snapshot.merged.contacts) {
      const contact = raw as Record<string, unknown>;
      await tx
        .insert(contactPoints)
        .values({
          id: contact.id as string,
          workspaceId: ctx.workspaceId,
          businessId: mergedId,
          type: contact.type as typeof contactPoints.$inferInsert.type,
          value: String(contact.value),
          normalizedValue: String(contact.normalizedValue),
          label: (contact.label as string | null) ?? null,
          platform: (contact.platform as string | null) ?? null,
          verifiedByUser: Boolean(contact.verifiedByUser),
          confidence: contact.confidence as typeof contactPoints.$inferInsert.confidence,
          firstSeenAt: toDate(contact.firstSeenAt) ?? new Date(),
          lastSeenAt: toDate(contact.lastSeenAt) ?? new Date(),
        })
        .onConflictDoNothing();
    }
    for (const raw of snapshot.merged.evidence) {
      const evidence = raw as Record<string, unknown>;
      await tx
        .insert(evidenceRecords)
        .values({
          id: evidence.id as string,
          workspaceId: ctx.workspaceId,
          businessId: mergedId,
          type: String(evidence.type),
          originalValue: String(evidence.originalValue),
          normalizedValue: (evidence.normalizedValue as string | null) ?? null,
          sourceUrl: String(evidence.sourceUrl),
          method: String(evidence.method),
          confidence: evidence.confidence as typeof evidenceRecords.$inferInsert.confidence,
          verificationStatus: String(evidence.verificationStatus ?? "unverified"),
          firstSeenAt: toDate(evidence.firstSeenAt) ?? new Date(),
          lastSeenAt: toDate(evidence.lastSeenAt) ?? new Date(),
        })
        .onConflictDoNothing();
    }
    for (const raw of snapshot.merged.sources) {
      const source = raw as Record<string, unknown>;
      await tx
        .insert(sourceRecords)
        .values({
          id: source.id as string,
          workspaceId: ctx.workspaceId,
          businessId: mergedId,
          source: source.source as typeof sourceRecords.$inferInsert.source,
          sourceId: String(source.sourceId),
          payload: (source.payload as Record<string, unknown> | null) ?? null,
          attribution: (source.attribution as string | null) ?? null,
          importJobId: (source.importJobId as string | null) ?? null,
        })
        .onConflictDoNothing();
    }

    // Remove records that were copied onto the kept lead during the merge.
    const keptContactIds = new Set(snapshot.keptBefore.contactIds);
    const currentContacts = await tx
      .select({ id: contactPoints.id })
      .from(contactPoints)
      .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.businessId, keptId)));
    for (const contact of currentContacts) {
      if (!keptContactIds.has(contact.id)) {
        await tx.delete(contactPoints).where(eq(contactPoints.id, contact.id));
      }
    }
    const keptEvidenceIds = new Set(snapshot.keptBefore.evidenceIds);
    const currentEvidence = await tx
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(and(eq(evidenceRecords.workspaceId, ctx.workspaceId), eq(evidenceRecords.businessId, keptId)));
    for (const evidence of currentEvidence) {
      if (!keptEvidenceIds.has(evidence.id)) {
        await tx.delete(evidenceRecords).where(eq(evidenceRecords.id, evidence.id));
      }
    }

    if (snapshot.merged.noteIds.length) {
      await tx
        .update(notes)
        .set({ businessId: mergedId })
        .where(and(eq(notes.workspaceId, ctx.workspaceId), inArray(notes.id, snapshot.merged.noteIds)));
    }
    if (snapshot.merged.activityIds.length) {
      await tx
        .update(activities)
        .set({ businessId: mergedId })
        .where(
          and(
            eq(activities.workspaceId, ctx.workspaceId),
            inArray(activities.id, snapshot.merged.activityIds),
          ),
        );
    }

    const keptTagIds = new Set(snapshot.keptBefore.tagIds);
    await tx
      .delete(businessTags)
      .where(
        and(
          eq(businessTags.workspaceId, ctx.workspaceId),
          eq(businessTags.businessId, keptId),
          snapshot.merged.tagIds.length ? inArray(businessTags.tagId, snapshot.merged.tagIds) : undefined,
          keptTagIds.size ? notInArray(businessTags.tagId, [...keptTagIds]) : undefined,
        ),
      );
    if (snapshot.merged.tagIds.length) {
      await tx
        .insert(businessTags)
        .values(
          snapshot.merged.tagIds.map((tagId) => ({ workspaceId: ctx.workspaceId, businessId: mergedId, tagId })),
        )
        .onConflictDoNothing();
    }

    if (snapshot.filledFields.length) {
      const updates: Record<string, unknown> = {};
      for (const field of snapshot.filledFields) updates[field] = null;
      await tx
        .update(businesses)
        .set(updates)
        .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, keptId)));
    }

    await tx
      .update(mergeHistory)
      .set({ undoneAt: new Date() })
      .where(eq(mergeHistory.id, history.id));

    await tx.insert(activities).values({
      workspaceId: ctx.workspaceId,
      businessId: keptId,
      type: "merged",
      message: "Merge undone",
      actorId: ctx.user.id,
    });
  });

  await recalculateLeadScore(ctx.workspaceId, history.keptBusinessId);
  await publishEvent(ctx.workspaceId, "duplicates.resolved", {
    businessId: history.keptBusinessId,
    action: "unmerged",
  });
  return { mergeId: history.id };
}

export interface DuplicatePair {
  id: string;
  similarity: number;
  distanceM: number | null;
  reasons: string[];
  status: string;
  a: {
    id: string;
    name: string;
    category: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    websiteHost: string | null;
    street: string | null;
    latestScore: number | null;
    status: string;
  };
  b: DuplicatePair["a"];
}

export async function listDuplicatePairs(ctx: ActorContext): Promise<DuplicatePair[]> {
  const a = alias(businesses, "a");
  const b = alias(businesses, "b");
  const rows = await db
    .select({
      id: duplicateCandidates.id,
      similarity: duplicateCandidates.similarity,
      distanceM: duplicateCandidates.distanceM,
      reasons: duplicateCandidates.reasons,
      status: duplicateCandidates.status,
      aId: a.id,
      aName: a.name,
      aCategory: a.category,
      aCity: a.city,
      aPhone: a.phone,
      aEmail: a.email,
      aHost: a.websiteHost,
      aStreet: a.street,
      aScore: a.latestScore,
      aStatus: a.status,
      bId: b.id,
      bName: b.name,
      bCategory: b.category,
      bCity: b.city,
      bPhone: b.phone,
      bEmail: b.email,
      bHost: b.websiteHost,
      bStreet: b.street,
      bScore: b.latestScore,
      bStatus: b.status,
    })
    .from(duplicateCandidates)
    .innerJoin(a, eq(a.id, duplicateCandidates.businessAId))
    .innerJoin(b, eq(b.id, duplicateCandidates.businessBId))
    .where(
      and(
        eq(duplicateCandidates.workspaceId, ctx.workspaceId),
        eq(duplicateCandidates.status, "pending"),
        isNull(a.mergedIntoId),
        isNull(b.mergedIntoId),
      ),
    )
    .orderBy(desc(duplicateCandidates.similarity))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    similarity: Math.round(row.similarity * 100) / 100,
    distanceM: row.distanceM,
    reasons: row.reasons,
    status: row.status,
    a: {
      id: row.aId,
      name: row.aName,
      category: row.aCategory,
      city: row.aCity,
      phone: row.aPhone,
      email: row.aEmail,
      websiteHost: row.aHost,
      street: row.aStreet,
      latestScore: row.aScore,
      status: row.aStatus,
    },
    b: {
      id: row.bId,
      name: row.bName,
      category: row.bCategory,
      city: row.bCity,
      phone: row.bPhone,
      email: row.bEmail,
      websiteHost: row.bHost,
      street: row.bStreet,
      latestScore: row.bScore,
      status: row.bStatus,
    },
  }));
}

export async function resolveDuplicate(
  ctx: ActorContext,
  id: string,
  action: "merge" | "keep_separate" | "skip",
  keep: "a" | "b" = "a",
): Promise<void> {
  const [pair] = await db
    .select()
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.workspaceId, ctx.workspaceId), eq(duplicateCandidates.id, id)))
    .limit(1);
  if (!pair) throw notFound("Duplicate candidate not found");
  if (pair.status !== "pending") throw conflict("This duplicate has already been resolved.");

  if (action === "merge") {
    const keptId = keep === "b" ? pair.businessBId : pair.businessAId;
    const mergedId = keep === "b" ? pair.businessAId : pair.businessBId;
    await mergeBusinesses(ctx, keptId, mergedId);
    await db
      .update(duplicateCandidates)
      .set({ status: "merged", resolvedAt: new Date(), resolvedBy: ctx.user.id })
      .where(eq(duplicateCandidates.id, id));
  } else {
    await db
      .update(duplicateCandidates)
      .set({
        status: action === "skip" ? "skipped" : "kept_separate",
        resolvedAt: new Date(),
        resolvedBy: ctx.user.id,
      })
      .where(eq(duplicateCandidates.id, id));
    await publishEvent(ctx.workspaceId, "duplicates.resolved", { action });
  }
}
