import type { Filter } from "mongodb";
import { collections, newId, now, withTransaction } from "@/lib/db";
import type {
  ActivityDoc,
  BusinessDoc,
  ContactPointDoc,
  EvidenceRecordDoc,
  MergeHistoryDoc,
  SourceRecordDoc,
} from "@/lib/db/types";
import type { ActorContext } from "@/lib/data/types";
import { decideDuplicate, type DedupeDecision, type DedupeRecord } from "./decide";
import { nameTokens } from "@/lib/normalize/text";
import { recalculateLeadScore } from "@/lib/score/service";
import { publishEvent } from "@/lib/events/bus";
import { notFound, conflict } from "@/lib/api/errors";

export interface MatchResult {
  candidateId: string;
  decision: DedupeDecision;
}

function toRecord(row: BusinessDoc): DedupeRecord {
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

  const signals: Filter<BusinessDoc>[] = [];
  if (incoming.phoneE164) signals.push({ phoneE164: incoming.phoneE164 });
  if (hostVariants.size) signals.push({ websiteHost: { $in: [...hostVariants] } });
  const tokens = nameTokens(incoming.name);
  if (tokens.length) signals.push({ nameTokens: { $in: tokens } });
  if (!signals.length) return null;

  const filter: Filter<BusinessDoc> = {
    workspaceId,
    mergedIntoId: null,
    $or: signals,
  };
  if (excludeBusinessId) filter._id = { $ne: excludeBusinessId };

  const rows = await collections.businesses.find(filter).limit(75).toArray();

  let bestMerge: MatchResult | null = null;
  let bestReview: MatchResult | null = null;
  for (const row of rows) {
    const decision = decideDuplicate(incoming, toRecord(row));
    if (decision.action === "merge" && (!bestMerge || decision.similarity > bestMerge.decision.similarity)) {
      bestMerge = { candidateId: row._id, decision };
    }
    if (decision.action === "review" && (!bestReview || decision.similarity > bestReview.decision.similarity)) {
      bestReview = { candidateId: row._id, decision };
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
  await collections.duplicateCandidates.updateOne(
    { workspaceId, businessAId: left, businessBId: right },
    {
      $setOnInsert: {
        _id: newId(),
        workspaceId,
        businessAId: left,
        businessBId: right,
        similarity: decision.similarity,
        distanceM: decision.distanceM,
        reasons: [decision.reason],
        status: "pending",
        createdAt: now(),
        resolvedAt: null,
        resolvedBy: null,
      },
    },
    { upsert: true },
  );
  await publishEvent(workspaceId, "duplicate.detected", { businessId: right });
}

interface MergeSnapshot {
  business: Record<string, unknown>;
  filledFields: string[];
  resolvedCandidateIds?: string[];
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

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  const mergeId = await withTransaction(async (session) => {
    const opt = { session };
    const kept = await collections.businesses.findOne(
      { workspaceId: ctx.workspaceId, _id: keptId },
      opt,
    );
    const merged = await collections.businesses.findOne(
      { workspaceId: ctx.workspaceId, _id: mergedId },
      opt,
    );
    if (!kept || !merged) throw notFound("One of the businesses was not found.");
    if (merged.mergedIntoId) throw conflict("That business has already been merged.");

    const [keptContacts, mergedContacts, keptSources, mergedSources, keptEvidence, mergedEvidence] =
      await Promise.all([
        collections.contactPoints
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, opt)
          .toArray(),
        collections.contactPoints
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, opt)
          .toArray(),
        collections.sourceRecords
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, opt)
          .toArray(),
        collections.sourceRecords
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, opt)
          .toArray(),
        collections.evidenceRecords
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, opt)
          .toArray(),
        collections.evidenceRecords
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, opt)
          .toArray(),
      ]);

    const [keptNotes, mergedNotes, keptActivities, mergedActivities, keptTags, mergedTags] =
      await Promise.all([
        collections.notes
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, { ...opt, projection: { _id: 1 } })
          .toArray(),
        collections.notes
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, { ...opt, projection: { _id: 1 } })
          .toArray(),
        collections.activities
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, { ...opt, projection: { _id: 1 } })
          .toArray(),
        collections.activities
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, { ...opt, projection: { _id: 1 } })
          .toArray(),
        collections.businessTags
          .find({ workspaceId: ctx.workspaceId, businessId: keptId }, opt)
          .toArray(),
        collections.businessTags
          .find({ workspaceId: ctx.workspaceId, businessId: mergedId }, opt)
          .toArray(),
      ]);

    const locked = new Set(kept.fieldLocks ?? []);
    const filledFields: string[] = [];
    const updates: Partial<BusinessDoc> = { updatedAt: now() };
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
        (updates as Record<string, unknown>)[field] = incoming;
        filledFields.push(field);
      }
    }
    if (merged.lastCheckedAt && (!kept.lastCheckedAt || merged.lastCheckedAt > kept.lastCheckedAt)) {
      updates.latestScanId = merged.latestScanId;
      updates.latestScanOutcome = merged.latestScanOutcome;
      updates.latestChatbotResult = merged.latestChatbotResult;
      updates.lastCheckedAt = merged.lastCheckedAt;
    }
    if (merged.hasWhatsapp) updates.hasWhatsapp = true;

    await collections.businesses.updateOne(
      { workspaceId: ctx.workspaceId, _id: keptId },
      { $set: updates },
      opt,
    );

    for (const contact of mergedContacts) {
      const existing = await collections.contactPoints.findOne(
        {
          businessId: keptId,
          type: contact.type,
          normalizedValue: contact.normalizedValue,
        },
        opt,
      );
      if (existing) {
        await collections.contactPoints.updateOne(
          { _id: existing._id },
          {
            $max: { lastSeenAt: contact.lastSeenAt },
            $set: { verifiedByUser: existing.verifiedByUser || contact.verifiedByUser },
          },
          opt,
        );
      } else {
        const { _id: _ignored, businessId: _ignoredBusiness, ...rest } = contact;
        await collections.contactPoints.insertOne(
          { ...rest, _id: newId(), workspaceId: ctx.workspaceId, businessId: keptId },
          opt,
        );
      }
    }
    if (mergedContacts.length) {
      await collections.contactPoints.deleteMany(
        { workspaceId: ctx.workspaceId, businessId: mergedId },
        opt,
      );
    }

    for (const evidence of mergedEvidence) {
      const existing = await collections.evidenceRecords.findOne(
        {
          businessId: keptId,
          type: evidence.type,
          originalValue: evidence.originalValue,
          sourceUrl: evidence.sourceUrl,
        },
        opt,
      );
      if (!existing) {
        const { _id: _ignored, businessId: _ignoredBusiness, ...rest } = evidence;
        await collections.evidenceRecords.insertOne(
          { ...rest, _id: newId(), workspaceId: ctx.workspaceId, businessId: keptId },
          opt,
        );
      }
    }
    if (mergedEvidence.length) {
      await collections.evidenceRecords.deleteMany(
        { workspaceId: ctx.workspaceId, businessId: mergedId },
        opt,
      );
    }

    for (const source of mergedSources) {
      const duplicate = keptSources.find(
        (existing) => existing.source === source.source && existing.sourceId === source.sourceId,
      );
      if (duplicate) {
        await collections.sourceRecords.deleteOne({ _id: source._id }, opt);
      } else {
        await collections.sourceRecords.updateOne(
          { _id: source._id },
          { $set: { businessId: keptId } },
          opt,
        );
      }
    }

    await collections.notes.updateMany(
      { workspaceId: ctx.workspaceId, businessId: mergedId },
      { $set: { businessId: keptId } },
      opt,
    );
    await collections.activities.updateMany(
      { workspaceId: ctx.workspaceId, businessId: mergedId },
      { $set: { businessId: keptId } },
      opt,
    );

    if (mergedTags.length) {
      for (const tag of mergedTags) {
        const id = `${keptId}:${tag.tagId}`;
        await collections.businessTags.updateOne(
          { _id: id },
          { $setOnInsert: { _id: id, workspaceId: ctx.workspaceId, businessId: keptId, tagId: tag.tagId } },
          { ...opt, upsert: true },
        );
      }
      await collections.businessTags.deleteMany(
        { workspaceId: ctx.workspaceId, businessId: mergedId },
        opt,
      );
    }

    const timestamp = now();
    await collections.businesses.updateOne(
      { workspaceId: ctx.workspaceId, _id: mergedId },
      { $set: { mergedIntoId: keptId, archivedAt: timestamp, updatedAt: timestamp } },
      opt,
    );

    const pendingCandidates = await collections.duplicateCandidates
      .find(
        {
          workspaceId: ctx.workspaceId,
          status: "pending",
          $or: [{ businessAId: mergedId }, { businessBId: mergedId }],
        },
        { ...opt, projection: { _id: 1 } },
      )
      .toArray();

    await collections.duplicateCandidates.updateMany(
      {
        workspaceId: ctx.workspaceId,
        status: "pending",
        $or: [{ businessAId: mergedId }, { businessBId: mergedId }],
      },
      { $set: { status: "merged", resolvedAt: timestamp, resolvedBy: ctx.user.id } },
      opt,
    );

    const snapshot: MergeSnapshot = {
      business: JSON.parse(JSON.stringify(merged)),
      filledFields,
      resolvedCandidateIds: pendingCandidates.map((row) => row._id),
      keptBefore: {
        contactIds: keptContacts.map((row) => row._id),
        sourceIds: keptSources.map((row) => row._id),
        evidenceIds: keptEvidence.map((row) => row._id),
        noteIds: keptNotes.map((row) => row._id),
        activityIds: keptActivities.map((row) => row._id),
        tagIds: keptTags.map((row) => row.tagId),
      },
      merged: {
        contacts: mergedContacts.map((row) => ({
          ...row,
          firstSeenAt: iso(row.firstSeenAt),
          lastSeenAt: iso(row.lastSeenAt),
          createdAt: iso(row.createdAt),
        })),
        sources: mergedSources.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
        evidence: mergedEvidence.map((row) => ({
          ...row,
          firstSeenAt: iso(row.firstSeenAt),
          lastSeenAt: iso(row.lastSeenAt),
        })),
        noteIds: mergedNotes.map((row) => row._id),
        activityIds: mergedActivities.map((row) => row._id),
        tagIds: mergedTags.map((row) => row.tagId),
      },
    };

    const historyId = newId();
    const history: MergeHistoryDoc = {
      _id: historyId,
      workspaceId: ctx.workspaceId,
      keptBusinessId: keptId,
      mergedBusinessId: mergedId,
      snapshot: snapshot as unknown as Record<string, unknown>,
      actorId: ctx.user.id,
      createdAt: timestamp,
      undoneAt: null,
    };
    await collections.mergeHistory.insertOne(history, opt);

    await collections.activities.insertOne(
      {
        _id: newId(),
        workspaceId: ctx.workspaceId,
        businessId: keptId,
        type: "merged",
        message: `Merged duplicate “${merged.name}” into this lead`,
        metadata: { mergedBusinessId: mergedId },
        actorId: ctx.user.id,
        createdAt: timestamp,
      },
      opt,
    );

    return historyId;
  });

  await recalculateLeadScore(ctx.workspaceId, keptId);
  await publishEvent(ctx.workspaceId, "duplicates.resolved", { businessId: keptId, action: "merged" });
  await publishEvent(ctx.workspaceId, "lead.updated", { businessId: keptId });
  return { keptId, mergedId, mergeId };
}

export async function undoLastMerge(ctx: ActorContext): Promise<{ mergeId: string } | null> {
  const history = await collections.mergeHistory.findOne(
    { workspaceId: ctx.workspaceId, undoneAt: null },
    { sort: { createdAt: -1 } },
  );
  if (!history) return null;

  const snapshot = history.snapshot as unknown as MergeSnapshot;
  const mergedId = history.mergedBusinessId;
  const keptId = history.keptBusinessId;

  await withTransaction(async (session) => {
    const opt = { session };
    const business = snapshot.business;

    await collections.businesses.updateOne(
      { workspaceId: ctx.workspaceId, _id: mergedId },
      {
        $set: {
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
          status: business.status as BusinessDoc["status"],
          notes: (business.notes as string | null) ?? null,
          followUpAt: toDate(business.followUpAt),
          ownerId: (business.ownerId as string | null) ?? null,
          doNotContact: Boolean(business.doNotContact),
          updatedAt: now(),
        },
      },
      opt,
    );

    if (snapshot.resolvedCandidateIds?.length) {
      await collections.duplicateCandidates.updateMany(
        {
          workspaceId: ctx.workspaceId,
          _id: { $in: snapshot.resolvedCandidateIds },
        },
        { $set: { status: "pending", resolvedAt: null, resolvedBy: null } },
        opt,
      );
    }

    for (const raw of snapshot.merged.contacts) {
      const contact = raw as Record<string, unknown>;
      const doc: ContactPointDoc = {
        _id: String(contact._id),
        workspaceId: ctx.workspaceId,
        businessId: mergedId,
        type: contact.type as ContactPointDoc["type"],
        value: String(contact.value),
        normalizedValue: String(contact.normalizedValue),
        label: (contact.label as string | null) ?? null,
        platform: (contact.platform as string | null) ?? null,
        verifiedByUser: Boolean(contact.verifiedByUser),
        confidence: contact.confidence as ContactPointDoc["confidence"],
        firstSeenAt: toDate(contact.firstSeenAt) ?? now(),
        lastSeenAt: toDate(contact.lastSeenAt) ?? now(),
        createdAt: toDate(contact.createdAt) ?? now(),
      };
      await collections.contactPoints.replaceOne(
        { _id: doc._id },
        doc,
        { ...opt, upsert: true },
      );
    }

    for (const raw of snapshot.merged.evidence) {
      const evidence = raw as Record<string, unknown>;
      const doc: EvidenceRecordDoc = {
        _id: String(evidence._id),
        workspaceId: ctx.workspaceId,
        businessId: mergedId,
        contactPointId: (evidence.contactPointId as string | null) ?? null,
        scanResultId: (evidence.scanResultId as string | null) ?? null,
        type: String(evidence.type),
        originalValue: String(evidence.originalValue),
        normalizedValue: (evidence.normalizedValue as string | null) ?? null,
        sourceUrl: String(evidence.sourceUrl),
        method: String(evidence.method),
        confidence: evidence.confidence as EvidenceRecordDoc["confidence"],
        verificationStatus: String(evidence.verificationStatus ?? "unverified"),
        firstSeenAt: toDate(evidence.firstSeenAt) ?? now(),
        lastSeenAt: toDate(evidence.lastSeenAt) ?? now(),
      };
      await collections.evidenceRecords.replaceOne(
        { _id: doc._id },
        doc,
        { ...opt, upsert: true },
      );
    }

    for (const raw of snapshot.merged.sources) {
      const source = raw as Record<string, unknown>;
      const doc: SourceRecordDoc = {
        _id: String(source._id),
        workspaceId: ctx.workspaceId,
        businessId: mergedId,
        source: source.source as SourceRecordDoc["source"],
        sourceId: String(source.sourceId),
        payload: (source.payload as Record<string, unknown> | null) ?? null,
        attribution: (source.attribution as string | null) ?? null,
        importJobId: (source.importJobId as string | null) ?? null,
        createdAt: toDate(source.createdAt) ?? now(),
      };
      await collections.sourceRecords.replaceOne(
        { _id: doc._id },
        doc,
        { ...opt, upsert: true },
      );
    }

    // Remove records that were copied onto the kept lead during the merge.
    const keptContactIds = new Set(snapshot.keptBefore.contactIds);
    const currentContacts = await collections.contactPoints
      .find(
        { workspaceId: ctx.workspaceId, businessId: keptId },
        { ...opt, projection: { _id: 1 } },
      )
      .toArray();
    for (const contact of currentContacts) {
      if (!keptContactIds.has(contact._id)) {
        await collections.contactPoints.deleteOne({ _id: contact._id }, opt);
      }
    }

    const keptEvidenceIds = new Set(snapshot.keptBefore.evidenceIds);
    const currentEvidence = await collections.evidenceRecords
      .find(
        { workspaceId: ctx.workspaceId, businessId: keptId },
        { ...opt, projection: { _id: 1 } },
      )
      .toArray();
    for (const evidence of currentEvidence) {
      if (!keptEvidenceIds.has(evidence._id)) {
        await collections.evidenceRecords.deleteOne({ _id: evidence._id }, opt);
      }
    }

    if (snapshot.merged.noteIds.length) {
      await collections.notes.updateMany(
        { workspaceId: ctx.workspaceId, _id: { $in: snapshot.merged.noteIds } },
        { $set: { businessId: mergedId } },
        opt,
      );
    }
    if (snapshot.merged.activityIds.length) {
      await collections.activities.updateMany(
        { workspaceId: ctx.workspaceId, _id: { $in: snapshot.merged.activityIds } },
        { $set: { businessId: mergedId } },
        opt,
      );
    }

    const keptTagIds = new Set(snapshot.keptBefore.tagIds);
    if (snapshot.merged.tagIds.length) {
      const removeIds = snapshot.merged.tagIds
        .filter((tagId) => !keptTagIds.has(tagId))
        .map((tagId) => `${keptId}:${tagId}`);
      if (removeIds.length) {
        await collections.businessTags.deleteMany({ _id: { $in: removeIds } }, opt);
      }
      for (const tagId of snapshot.merged.tagIds) {
        const id = `${mergedId}:${tagId}`;
        await collections.businessTags.updateOne(
          { _id: id },
          { $setOnInsert: { _id: id, workspaceId: ctx.workspaceId, businessId: mergedId, tagId } },
          { ...opt, upsert: true },
        );
      }
    }

    if (snapshot.filledFields.length) {
      const updates: Record<string, unknown> = {};
      for (const field of snapshot.filledFields) updates[field] = null;
      await collections.businesses.updateOne(
        { workspaceId: ctx.workspaceId, _id: keptId },
        { $set: updates },
        opt,
      );
    }

    // Recompute the denormalized WhatsApp flag for both leads.
    for (const businessId of [keptId, mergedId]) {
      const whatsapp = await collections.contactPoints.countDocuments(
        { workspaceId: ctx.workspaceId, businessId, type: "whatsapp" },
        opt,
      );
      await collections.businesses.updateOne(
        { workspaceId: ctx.workspaceId, _id: businessId },
        { $set: { hasWhatsapp: whatsapp > 0 } },
        opt,
      );
    }

    await collections.mergeHistory.updateOne(
      { _id: history._id },
      { $set: { undoneAt: now() } },
      opt,
    );

    const activity: ActivityDoc = {
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId: keptId,
      type: "merged",
      message: "Merge undone",
      metadata: null,
      actorId: ctx.user.id,
      createdAt: now(),
    };
    await collections.activities.insertOne(activity, opt);
  });

  await recalculateLeadScore(ctx.workspaceId, history.keptBusinessId);
  await publishEvent(ctx.workspaceId, "duplicates.resolved", {
    businessId: history.keptBusinessId,
    action: "unmerged",
  });
  return { mergeId: history._id };
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
  const candidates = await collections.duplicateCandidates
    .find({ workspaceId: ctx.workspaceId, status: "pending" })
    .sort({ similarity: -1 })
    .limit(400)
    .toArray();

  const ids = [...new Set(candidates.flatMap((row) => [row.businessAId, row.businessBId]))];
  const businesses = ids.length
    ? await collections.businesses.find({ _id: { $in: ids } }).toArray()
    : [];
  const byId = new Map(businesses.map((business) => [business._id, business]));

  const pairs: DuplicatePair[] = [];
  for (const candidate of candidates) {
    const a = byId.get(candidate.businessAId);
    const b = byId.get(candidate.businessBId);
    if (!a || !b || a.mergedIntoId || b.mergedIntoId) continue;
    const view = (business: BusinessDoc): DuplicatePair["a"] => ({
      id: business._id,
      name: business.name,
      category: business.category,
      city: business.city,
      phone: business.phone,
      email: business.email,
      websiteHost: business.websiteHost,
      street: business.street,
      latestScore: business.latestScore,
      status: business.status,
    });
    pairs.push({
      id: candidate._id,
      similarity: Math.round(candidate.similarity * 100) / 100,
      distanceM: candidate.distanceM,
      reasons: candidate.reasons,
      status: candidate.status,
      a: view(a),
      b: view(b),
    });
    if (pairs.length >= 100) break;
  }
  return pairs;
}

export async function resolveDuplicate(
  ctx: ActorContext,
  id: string,
  action: "merge" | "keep_separate" | "skip",
  keep: "a" | "b" = "a",
): Promise<void> {
  const pair = await collections.duplicateCandidates.findOne({
    workspaceId: ctx.workspaceId,
    _id: id,
  });
  if (!pair) throw notFound("Duplicate candidate not found");
  if (pair.status !== "pending") throw conflict("This duplicate has already been resolved.");

  if (action === "merge") {
    const keptId = keep === "b" ? pair.businessBId : pair.businessAId;
    const mergedId = keep === "b" ? pair.businessAId : pair.businessBId;
    await mergeBusinesses(ctx, keptId, mergedId);
    await collections.duplicateCandidates.updateOne(
      { _id: id },
      { $set: { status: "merged", resolvedAt: now(), resolvedBy: ctx.user.id } },
    );
  } else {
    await collections.duplicateCandidates.updateOne(
      { _id: id },
      {
        $set: {
          status: action === "skip" ? "skipped" : "kept_separate",
          resolvedAt: now(),
          resolvedBy: ctx.user.id,
        },
      },
    );
    await publishEvent(ctx.workspaceId, "duplicates.resolved", { action });
  }
}
