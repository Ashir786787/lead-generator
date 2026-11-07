import type { Document, Filter } from "mongodb";
import { collections } from "@/lib/db";
import type { BusinessDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { splitList, type LeadQuery } from "@/lib/data/filters";
import { notFound } from "@/lib/api/errors";
import type { PipelineStatus } from "@/lib/constants";

export interface LeadRow {
  id: string;
  name: string;
  category: string | null;
  categoryKey: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  websiteHost: string | null;
  latestScore: number | null;
  latestScanOutcome: string | null;
  latestChatbotResult: string | null;
  status: PipelineStatus;
  lastCheckedAt: string | null;
  followUpAt: string | null;
  doNotContact: boolean;
  updatedAt: string | null;
  contacts: Array<{ type: string; value: string; platform: string | null; label: string | null }>;
}

export interface LeadStats {
  total: number;
  withWebsite: number;
  withEmail: number;
  withWhatsapp: number;
  duplicates: number;
  overdueFollowUps: number;
}

export interface LeadListResult {
  items: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  stats: LeadStats;
  workspaceStats: LeadStats;
}

const FOLLOW_UP_STATUSES: PipelineStatus[] = [
  "follow_up",
  "contacted",
  "proposal_sent",
  "qualified",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function startOfUtcDay(reference = new Date()): Date {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );
}

/** Shared filter builder — the list API and CSV export must use the same predicate. */
export function buildLeadWhere(
  workspaceId: string,
  query: LeadQuery,
): Filter<BusinessDoc> {
  const and: Filter<BusinessDoc>[] = [
    { mergedIntoId: null },
  ];
  if (!query.includeArchived) and.push({ archivedAt: null });
  if (!query.includeDnc) and.push({ doNotContact: false });

  if (query.q) {
    const pattern = { $regex: escapeRegex(query.q), $options: "i" };
    and.push({
      $or: [
        { name: pattern },
        { email: pattern },
        { phoneE164: pattern },
        { city: pattern },
        { websiteHost: pattern },
        { category: pattern },
      ],
    } as Filter<BusinessDoc>);
  }

  const cities = splitList(query.city);
  if (cities.length) and.push({ city: { $in: cities } });

  const ids = splitList(query.ids);
  if (ids.length) and.push({ _id: { $in: ids } });

  const statuses = splitList(query.status) as PipelineStatus[];
  if (statuses.length) and.push({ status: { $in: statuses } });

  const categories = splitList(query.category);
  if (categories.length) and.push({ categoryKey: { $in: categories } });

  if (query.minScore !== undefined) and.push({ latestScore: { $gte: query.minScore } });
  if (query.maxScore !== undefined) and.push({ latestScore: { $lte: query.maxScore } });

  if (query.hasWebsite === true) and.push({ websiteHost: { $ne: null } });
  if (query.hasWebsite === false) and.push({ websiteHost: null });
  if (query.hasEmail === true) and.push({ email: { $ne: null } });
  if (query.hasEmail === false) and.push({ email: null });

  if (query.hasWhatsapp === true) and.push({ hasWhatsapp: true });
  if (query.hasWhatsapp === false) and.push({ hasWhatsapp: { $ne: true } });

  if (query.scanOutcome) {
    const outcomes = splitList(query.scanOutcome);
    if (outcomes.length) {
      and.push({ latestScanOutcome: { $in: outcomes } as Filter<BusinessDoc>["latestScanOutcome"] });
    }
  }
  if (query.chatbot) and.push({ latestChatbotResult: query.chatbot });

  if (query.followUp === "any") and.push({ followUpAt: { $ne: null } });
  if (query.followUp === "overdue") {
    and.push({ followUpAt: { $lt: new Date() } });
    and.push({ status: { $in: FOLLOW_UP_STATUSES } });
  }
  if (query.followUp === "today") {
    const start = startOfUtcDay();
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    and.push({ followUpAt: { $gte: start, $lt: end } });
  }

  return { workspaceId, $and: and } as Filter<BusinessDoc>;
}

function combine(
  base: Filter<BusinessDoc>,
  extra: Filter<BusinessDoc>,
): Filter<BusinessDoc> {
  return { $and: [base, extra] } as Filter<BusinessDoc>;
}

function listPipeline(
  conditions: Filter<BusinessDoc>,
  sort: LeadQuery["sort"],
  skip: number,
  limit: number,
): Document[] {
  const stages: Document[] = [{ $match: conditions }];
  switch (sort) {
    case "score_asc":
      stages.push({
        $addFields: { __scoreSort: { $ifNull: ["$latestScore", 1_000_000_000] } },
      });
      stages.push({ $sort: { __scoreSort: 1, normalizedName: 1 } });
      break;
    case "name_asc":
      stages.push({ $sort: { normalizedName: 1 } });
      break;
    case "name_desc":
      stages.push({ $sort: { normalizedName: -1 } });
      break;
    case "city_asc":
      stages.push({ $addFields: { __citySort: { $ifNull: ["$city", "\uffff"] } } });
      stages.push({ $sort: { __citySort: 1, normalizedName: 1 } });
      break;
    case "last_checked_desc":
      stages.push({
        $addFields: { __checkedSort: { $ifNull: ["$lastCheckedAt", new Date(0)] } },
      });
      stages.push({ $sort: { __checkedSort: -1 } });
      break;
    case "created_desc":
      stages.push({ $sort: { createdAt: -1 } });
      break;
    case "score_desc":
    default:
      stages.push({
        $addFields: { __scoreSort: { $ifNull: ["$latestScore", -1] } },
      });
      stages.push({ $sort: { __scoreSort: -1, normalizedName: 1 } });
      break;
  }
  stages.push({ $skip: skip }, { $limit: limit });
  stages.push({
    $project: {
      _id: 1,
      name: 1,
      category: 1,
      categoryKey: 1,
      city: 1,
      country: 1,
      phone: 1,
      email: 1,
      websiteUrl: 1,
      websiteHost: 1,
      latestScore: 1,
      latestScanOutcome: 1,
      latestChatbotResult: 1,
      status: 1,
      lastCheckedAt: 1,
      followUpAt: 1,
      doNotContact: 1,
      updatedAt: 1,
    },
  });
  return stages;
}

async function statsFor(conditions: Filter<BusinessDoc>): Promise<LeadStats> {
  const now = new Date();
  const [total, withWebsite, withEmail, withWhatsapp, overdueFollowUps] = await Promise.all([
    collections.businesses.countDocuments(conditions),
    collections.businesses.countDocuments(
      combine(conditions, { websiteHost: { $ne: null } } as Filter<BusinessDoc>),
    ),
    collections.businesses.countDocuments(
      combine(conditions, { email: { $ne: null } } as Filter<BusinessDoc>),
    ),
    collections.businesses.countDocuments(
      combine(conditions, { hasWhatsapp: true } as Filter<BusinessDoc>),
    ),
    collections.businesses.countDocuments(
      combine(conditions, {
        followUpAt: { $lt: now, $ne: null },
        status: { $in: FOLLOW_UP_STATUSES },
      } as Filter<BusinessDoc>),
    ),
  ]);
  return { total, withWebsite, withEmail, withWhatsapp, duplicates: 0, overdueFollowUps };
}

async function pendingDuplicateCount(workspaceId: string): Promise<number> {
  return collections.duplicateCandidates.countDocuments({
    workspaceId,
    status: "pending",
  });
}

export async function listLeads(ctx: WorkspaceContext, query: LeadQuery): Promise<LeadListResult> {
  const conditions = buildLeadWhere(ctx.workspaceId, query);
  const offset = (query.page - 1) * query.pageSize;
  const workspaceBase: Filter<BusinessDoc> = {
    workspaceId: ctx.workspaceId,
    mergedIntoId: null,
    archivedAt: null,
    doNotContact: false,
  };

  const [rows, total, stats, workspaceStats, duplicates, overdue] = await Promise.all([
    collections.businesses
      .aggregate<BusinessDoc>(listPipeline(conditions, query.sort, offset, query.pageSize))
      .toArray(),
    collections.businesses.countDocuments(conditions),
    statsFor(conditions),
    statsFor(workspaceBase),
    pendingDuplicateCount(ctx.workspaceId),
    collections.businesses.countDocuments({
      workspaceId: ctx.workspaceId,
      mergedIntoId: null,
      doNotContact: false,
      followUpAt: { $lt: new Date(), $ne: null },
      status: { $in: FOLLOW_UP_STATUSES },
    }),
  ]);

  const ids = rows.map((row) => row._id);
  const contactRows = ids.length
    ? await collections.contactPoints
        .find({
          workspaceId: ctx.workspaceId,
          businessId: { $in: ids },
          type: { $in: ["whatsapp", "social", "email", "phone"] },
        })
        .toArray()
    : [];

  const contactMap = new Map<string, LeadRow["contacts"]>();
  for (const contact of contactRows) {
    const list = contactMap.get(contact.businessId) ?? [];
    list.push({
      type: contact.type,
      value:
        contact.type === "email" || contact.type === "phone"
          ? contact.value
          : contact.normalizedValue,
      platform: contact.platform,
      label: contact.label,
    });
    contactMap.set(contact.businessId, list);
  }

  return {
    items: rows.map((row) => ({
      id: row._id,
      name: row.name,
      category: row.category,
      categoryKey: row.categoryKey,
      city: row.city,
      country: row.country,
      phone: row.phone,
      email: row.email,
      websiteUrl: row.websiteUrl,
      websiteHost: row.websiteHost,
      latestScore: row.latestScore,
      latestScanOutcome: row.latestScanOutcome,
      latestChatbotResult: row.latestChatbotResult,
      status: row.status,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      followUpAt: row.followUpAt?.toISOString() ?? null,
      doNotContact: row.doNotContact,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      contacts: contactMap.get(row._id) ?? [],
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    stats: { ...stats, duplicates, overdueFollowUps: overdue },
    workspaceStats: { ...workspaceStats, duplicates, overdueFollowUps: overdue },
  };
}

export interface LeadDetail {
  lead: LeadRow & {
    normalizedName: string;
    street: string | null;
    area: string | null;
    lat: number | null;
    lng: number | null;
    notes: string | null;
    ownerId: string | null;
    archivedAt: string | null;
    isDemo: boolean;
    createdAt: string | null;
  };
  contacts: Array<{
    id: string;
    type: string;
    value: string;
    normalizedValue: string;
    label: string | null;
    platform: string | null;
    verifiedByUser: boolean;
    confidence: string;
    firstSeenAt: string;
    lastSeenAt: string;
    evidence: Array<{ id: string; sourceUrl: string; method: string; originalValue: string; confidence: string }>;
  }>;
  latestScan: {
    id: string;
    outcome: string;
    chatbotResult: string;
    chatWidgets: unknown[];
    platform: string | null;
    platformConfidence: string | null;
    title: string | null;
    lang: string | null;
    httpStatus: number | null;
    finalUrl: string | null;
    pagesScanned: number;
    pagesSkipped: number;
    confidence: string;
    pageDetails: unknown[];
    createdAt: string;
  } | null;
  score: {
    id: string;
    total: number;
    components: unknown[];
    profileVersion: number;
    calculatedAt: string;
  } | null;
  sources: Array<{
    id: string;
    source: string;
    sourceId: string;
    attribution: string | null;
    createdAt: string;
    importJobId: string | null;
  }>;
  activities: Array<{
    id: string;
    type: string;
    message: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  tags: Array<{ id: string; name: string; color: string }>;
  duplicates: Array<{
    id: string;
    status: string;
    otherId: string;
    otherName: string;
    similarity: number;
  }>;
  merges: Array<{ id: string; mergedBusinessId: string; createdAt: string; undoneAt: string | null }>;
}

export async function getLeadDetail(ctx: WorkspaceContext, id: string): Promise<LeadDetail> {
  const row = await collections.businesses.findOne({
    workspaceId: ctx.workspaceId,
    _id: id,
  });
  if (!row) throw notFound("Lead not found");

  const [contacts, scanRow, scoreRow, sources, activityRows, tagLinks, duplicateRows, mergeRows, evidenceRows] =
    await Promise.all([
      collections.contactPoints
        .find({ workspaceId: ctx.workspaceId, businessId: id })
        .sort({ type: 1 })
        .toArray(),
      collections.scanResults.findOne(
        { workspaceId: ctx.workspaceId, businessId: id },
        { sort: { createdAt: -1 } },
      ),
      collections.scoreResults.findOne(
        { workspaceId: ctx.workspaceId, businessId: id },
        { sort: { calculatedAt: -1 } },
      ),
      collections.sourceRecords
        .find({ workspaceId: ctx.workspaceId, businessId: id })
        .sort({ createdAt: 1 })
        .toArray(),
      collections.activities
        .find({ workspaceId: ctx.workspaceId, businessId: id })
        .sort({ createdAt: -1 })
        .limit(40)
        .toArray(),
      collections.businessTags
        .find({ workspaceId: ctx.workspaceId, businessId: id })
        .toArray(),
      pendingDuplicates(ctx.workspaceId, id),
      collections.mergeHistory
        .find({
          workspaceId: ctx.workspaceId,
          $or: [{ keptBusinessId: id }, { mergedBusinessId: id }],
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
      collections.evidenceRecords
        .find({ workspaceId: ctx.workspaceId, businessId: id })
        .sort({ lastSeenAt: -1 })
        .limit(200)
        .toArray(),
    ]);

  const tagRows = tagLinks.length
    ? await collections.tags
        .find({
          _id: { $in: tagLinks.map((link) => link.tagId) },
        })
        .toArray()
    : [];

  const evidenceByContact = new Map<string, LeadDetail["contacts"][number]["evidence"]>();
  const evidenceByType = new Map<string, LeadDetail["contacts"][number]["evidence"]>();
  for (const evidence of evidenceRows) {
    const item = {
      id: evidence._id,
      sourceUrl: evidence.sourceUrl,
      method: evidence.method,
      originalValue: evidence.originalValue,
      confidence: evidence.confidence,
    };
    if (evidence.contactPointId) {
      const list = evidenceByContact.get(evidence.contactPointId) ?? [];
      list.push(item);
      evidenceByContact.set(evidence.contactPointId, list);
    }
    const typeList = evidenceByType.get(evidence.type) ?? [];
    typeList.push(item);
    evidenceByType.set(evidence.type, typeList);
  }

  return {
    lead: {
      id: row._id,
      name: row.name,
      normalizedName: row.normalizedName,
      category: row.category,
      categoryKey: row.categoryKey,
      city: row.city,
      country: row.country,
      street: row.street,
      area: row.area,
      phone: row.phone,
      email: row.email,
      websiteUrl: row.websiteUrl,
      websiteHost: row.websiteHost,
      latestScore: row.latestScore,
      latestScanOutcome: row.latestScanOutcome,
      latestChatbotResult: row.latestChatbotResult,
      status: row.status,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      followUpAt: row.followUpAt?.toISOString() ?? null,
      doNotContact: row.doNotContact,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      lat: row.lat,
      lng: row.lng,
      notes: row.notes,
      ownerId: row.ownerId,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      isDemo: row.isDemo,
      createdAt: row.createdAt?.toISOString() ?? null,
      contacts: contacts.map((contact) => ({
        type: contact.type,
        value: contact.value,
        platform: contact.platform,
        label: contact.label,
      })),
    },
    contacts: contacts.map((contact) => ({
      id: contact._id,
      type: contact.type,
      value: contact.value,
      normalizedValue: contact.normalizedValue,
      label: contact.label,
      platform: contact.platform,
      verifiedByUser: contact.verifiedByUser,
      confidence: contact.confidence,
      firstSeenAt: contact.firstSeenAt.toISOString(),
      lastSeenAt: contact.lastSeenAt.toISOString(),
      evidence: evidenceByContact.get(contact._id) ?? evidenceByType.get(contact.type) ?? [],
    })),
    latestScan: scanRow
      ? {
          id: scanRow._id,
          outcome: scanRow.outcome,
          chatbotResult: scanRow.chatbotResult,
          chatWidgets: scanRow.chatWidgets,
          platform: scanRow.platform,
          platformConfidence: scanRow.platformConfidence,
          title: scanRow.title,
          lang: scanRow.lang,
          httpStatus: scanRow.httpStatus,
          finalUrl: scanRow.finalUrl,
          pagesScanned: scanRow.pagesScanned,
          pagesSkipped: scanRow.pagesSkipped,
          confidence: scanRow.confidence,
          pageDetails: scanRow.pageDetails,
          createdAt: scanRow.createdAt.toISOString(),
        }
      : null,
    score: scoreRow
      ? {
          id: scoreRow._id,
          total: scoreRow.total,
          components: scoreRow.components as unknown as unknown[],
          profileVersion: scoreRow.profileVersion,
          calculatedAt: scoreRow.calculatedAt.toISOString(),
        }
      : null,
    sources: sources.map((source) => ({
      id: source._id,
      source: source.source,
      sourceId: source.sourceId,
      attribution: source.attribution,
      createdAt: source.createdAt.toISOString(),
      importJobId: source.importJobId,
    })),
    activities: activityRows.map((activity) => ({
      id: activity._id,
      type: activity.type,
      message: activity.message,
      metadata: activity.metadata ?? null,
      createdAt: activity.createdAt.toISOString(),
    })),
    tags: tagRows.map((tag) => ({ id: tag._id, name: tag.name, color: tag.color })),
    duplicates: duplicateRows,
    merges: mergeRows.map((merge) => ({
      id: merge._id,
      mergedBusinessId: merge.mergedBusinessId,
      createdAt: merge.createdAt.toISOString(),
      undoneAt: merge.undoneAt?.toISOString() ?? null,
    })),
  };
}

async function pendingDuplicates(
  workspaceId: string,
  businessId: string,
): Promise<LeadDetail["duplicates"]> {
  const rows = await collections.duplicateCandidates
    .find({
      workspaceId,
      status: "pending",
      $or: [{ businessAId: businessId }, { businessBId: businessId }],
    })
    .limit(20)
    .toArray();

  const otherIds = rows.map((row) =>
    row.businessAId === businessId ? row.businessBId : row.businessAId,
  );
  const names = otherIds.length
    ? await collections.businesses
        .find({ _id: { $in: otherIds } }, { projection: { _id: 1, name: 1 } })
        .toArray()
    : [];
  const nameById = new Map(names.map((name) => [name._id, name.name]));

  return rows.map((row) => {
    const otherId = row.businessAId === businessId ? row.businessBId : row.businessAId;
    return {
      id: row._id,
      status: row.status,
      similarity: row.similarity,
      otherId,
      otherName: nameById.get(otherId) ?? "",
    };
  });
}
