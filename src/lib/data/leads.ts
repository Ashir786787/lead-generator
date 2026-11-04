import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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
  scanResults,
  scoreResults,
  sourceRecords,
  tags,
} from "@/lib/db/schema";
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Shared WHERE builder — the list API and CSV export must use the same predicate. */
export function buildLeadWhere(workspaceId: string, query: LeadQuery): SQL[] {
  const conditions: SQL[] = [
    eq(businesses.workspaceId, workspaceId),
    isNull(businesses.mergedIntoId),
  ];
  if (!query.includeArchived) conditions.push(isNull(businesses.archivedAt));
  if (!query.includeDnc) conditions.push(eq(businesses.doNotContact, false));

  if (query.q) {
    const term = `%${escapeLike(query.q)}%`;
    const search = or(
      ilike(businesses.name, term),
      ilike(businesses.email, term),
      ilike(businesses.phoneE164, term),
      ilike(businesses.city, term),
      ilike(businesses.websiteHost, term),
      ilike(businesses.category, term),
    );
    if (search) conditions.push(search);
  }
  const cities = splitList(query.city);
  if (cities.length) conditions.push(inArray(businesses.city, cities));
  const ids = splitList(query.ids);
  if (ids.length) conditions.push(inArray(businesses.id, ids));
  const statuses = splitList(query.status) as PipelineStatus[];
  if (statuses.length) conditions.push(inArray(businesses.status, statuses));
  const categories = splitList(query.category);
  if (categories.length) conditions.push(inArray(businesses.categoryKey, categories));
  if (query.minScore !== undefined) conditions.push(gte(businesses.latestScore, query.minScore));
  if (query.maxScore !== undefined) conditions.push(lte(businesses.latestScore, query.maxScore));

  if (query.hasWebsite === true) conditions.push(isNotNull(businesses.websiteHost));
  if (query.hasWebsite === false) conditions.push(isNull(businesses.websiteHost));
  if (query.hasEmail === true) conditions.push(isNotNull(businesses.email));
  if (query.hasEmail === false) conditions.push(isNull(businesses.email));

  if (query.hasWhatsapp === true) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${contactPoints} cp WHERE cp.business_id = ${businesses.id} AND cp.type = 'whatsapp')`,
    );
  }
  if (query.hasWhatsapp === false) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${contactPoints} cp WHERE cp.business_id = ${businesses.id} AND cp.type = 'whatsapp')`,
    );
  }
  if (query.scanOutcome) {
    const outcomes = splitList(query.scanOutcome);
    if (outcomes.length) {
      conditions.push(inArray(sql`${businesses.latestScanOutcome}::text`, outcomes));
    }
  }
  if (query.chatbot) conditions.push(eq(businesses.latestChatbotResult, query.chatbot));

  if (query.followUp === "any") conditions.push(isNotNull(businesses.followUpAt));
  if (query.followUp === "overdue") {
    conditions.push(sql`${businesses.followUpAt} < now()`);
    conditions.push(inArray(businesses.status, ["follow_up", "contacted", "proposal_sent", "qualified"]));
  }
  if (query.followUp === "today") {
    conditions.push(sql`${businesses.followUpAt} >= date_trunc('day', now())`);
    conditions.push(sql`${businesses.followUpAt} < date_trunc('day', now()) + interval '1 day'`);
  }
  return conditions;
}

function orderBy(sort: LeadQuery["sort"]) {
  switch (sort) {
    case "score_asc":
      return [sql`${businesses.latestScore} asc nulls last`, asc(businesses.name)];
    case "name_asc":
      return [asc(businesses.normalizedName)];
    case "name_desc":
      return [desc(businesses.normalizedName)];
    case "city_asc":
      return [sql`${businesses.city} asc nulls last`, asc(businesses.normalizedName)];
    case "last_checked_desc":
      return [sql`${businesses.lastCheckedAt} desc nulls last`];
    case "created_desc":
      return [desc(businesses.createdAt)];
    case "score_desc":
    default:
      return [sql`${businesses.latestScore} desc nulls last`, asc(businesses.normalizedName)];
  }
}

async function statsFor(conditions: SQL[]): Promise<LeadStats> {
  const [row] = await db
    .select({
      total: count(),
      withWebsite: sql<number>`count(*) filter (where ${businesses.websiteHost} is not null)`,
      withEmail: sql<number>`count(*) filter (where ${businesses.email} is not null)`,
      withWhatsapp: sql<number>`count(*) filter (where exists (
        select 1 from ${contactPoints} cp
        where cp.business_id = ${businesses.id} and cp.type = 'whatsapp'
      ))`,
      overdueFollowUps: sql<number>`count(*) filter (where ${businesses.followUpAt} < now()
        and ${businesses.status} in ('follow_up','contacted','proposal_sent','qualified'))`,
      duplicates: sql<number>`0`,
    })
    .from(businesses)
    .where(and(...conditions));
  return {
    total: Number(row?.total ?? 0),
    withWebsite: Number(row?.withWebsite ?? 0),
    withEmail: Number(row?.withEmail ?? 0),
    withWhatsapp: Number(row?.withWhatsapp ?? 0),
    duplicates: 0,
    overdueFollowUps: Number(row?.overdueFollowUps ?? 0),
  };
}

async function pendingDuplicateCount(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(duplicateCandidates)
    .where(
      and(
        eq(duplicateCandidates.workspaceId, workspaceId),
        eq(duplicateCandidates.status, "pending"),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function listLeads(ctx: WorkspaceContext, query: LeadQuery): Promise<LeadListResult> {
  const conditions = buildLeadWhere(ctx.workspaceId, query);
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow, stats, globalConditions, duplicates, overdue] = await Promise.all([
    db
      .select({
        id: businesses.id,
        name: businesses.name,
        category: businesses.category,
        categoryKey: businesses.categoryKey,
        city: businesses.city,
        country: businesses.country,
        phone: businesses.phone,
        email: businesses.email,
        websiteUrl: businesses.websiteUrl,
        websiteHost: businesses.websiteHost,
        latestScore: businesses.latestScore,
        latestScanOutcome: businesses.latestScanOutcome,
        latestChatbotResult: businesses.latestChatbotResult,
        status: businesses.status,
        lastCheckedAt: businesses.lastCheckedAt,
        followUpAt: businesses.followUpAt,
        doNotContact: businesses.doNotContact,
        updatedAt: businesses.updatedAt,
      })
      .from(businesses)
      .where(and(...conditions))
      .orderBy(...orderBy(query.sort))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ value: count() }).from(businesses).where(and(...conditions)),
    statsFor(conditions),
    statsFor([
      eq(businesses.workspaceId, ctx.workspaceId),
      isNull(businesses.mergedIntoId),
      isNull(businesses.archivedAt),
    ]),
    pendingDuplicateCount(ctx.workspaceId),
    db
      .select({ value: count() })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          eq(businesses.doNotContact, false),
          sql`${businesses.followUpAt} < now()`,
          inArray(businesses.status, ["follow_up", "contacted", "proposal_sent", "qualified"]),
        ),
      ),
  ]);

  const ids = rows.map((row) => row.id);
  const contactRows = ids.length
    ? await db
        .select({
          businessId: contactPoints.businessId,
          type: contactPoints.type,
          value: contactPoints.value,
          normalizedValue: contactPoints.normalizedValue,
          platform: contactPoints.platform,
          label: contactPoints.label,
        })
        .from(contactPoints)
        .where(
          and(
            eq(contactPoints.workspaceId, ctx.workspaceId),
            inArray(contactPoints.businessId, ids),
            inArray(contactPoints.type, ["whatsapp", "social", "email", "phone"]),
          ),
        )
    : [];

  const contactMap = new Map<string, LeadRow["contacts"]>();
  for (const contact of contactRows) {
    const list = contactMap.get(contact.businessId) ?? [];
    list.push({
      type: contact.type,
      value: contact.type === "email" || contact.type === "phone" ? contact.value : contact.normalizedValue,
      platform: contact.platform,
      label: contact.label,
    });
    contactMap.set(contact.businessId, list);
  }

  return {
    items: rows.map((row) => ({
      ...row,
      status: row.status as PipelineStatus,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      followUpAt: row.followUpAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      contacts: contactMap.get(row.id) ?? [],
    })),
    total: Number(totalRow[0]?.value ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    stats: { ...stats, duplicates, overdueFollowUps: Number(overdue[0]?.value ?? 0) },
    workspaceStats: { ...globalConditions, duplicates, overdueFollowUps: Number(overdue[0]?.value ?? 0) },
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
  const [row] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, id)))
    .limit(1);
  if (!row) throw notFound("Lead not found");

  const [contacts, scan, scores, sources, activityRows, tagRows, duplicateRows, mergeRows, evidenceRows] =
    await Promise.all([
      db
        .select()
        .from(contactPoints)
        .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.businessId, id)))
        .orderBy(asc(contactPoints.type)),
      db
        .select()
        .from(scanResults)
        .where(and(eq(scanResults.workspaceId, ctx.workspaceId), eq(scanResults.businessId, id)))
        .orderBy(desc(scanResults.createdAt))
        .limit(1),
      db
        .select()
        .from(scoreResults)
        .where(and(eq(scoreResults.workspaceId, ctx.workspaceId), eq(scoreResults.businessId, id)))
        .orderBy(desc(scoreResults.calculatedAt))
        .limit(1),
      db
        .select()
        .from(sourceRecords)
        .where(and(eq(sourceRecords.workspaceId, ctx.workspaceId), eq(sourceRecords.businessId, id)))
        .orderBy(asc(sourceRecords.createdAt)),
      db
        .select()
        .from(activities)
        .where(and(eq(activities.workspaceId, ctx.workspaceId), eq(activities.businessId, id)))
        .orderBy(desc(activities.createdAt))
        .limit(40),
      db
        .select({ id: tags.id, name: tags.name, color: tags.color })
        .from(businessTags)
        .innerJoin(tags, eq(tags.id, businessTags.tagId))
        .where(and(eq(businessTags.workspaceId, ctx.workspaceId), eq(businessTags.businessId, id))),
      pendingDuplicates(ctx.workspaceId, id),
      db
        .select()
        .from(mergeHistory)
        .where(
          and(
            eq(mergeHistory.workspaceId, ctx.workspaceId),
            or(eq(mergeHistory.keptBusinessId, id), sql`${mergeHistory.mergedBusinessId} = ${id}`),
          ),
        )
        .orderBy(desc(mergeHistory.createdAt))
        .limit(10),
      db
        .select()
        .from(evidenceRecords)
        .where(and(eq(evidenceRecords.workspaceId, ctx.workspaceId), eq(evidenceRecords.businessId, id)))
        .orderBy(desc(evidenceRecords.lastSeenAt))
        .limit(200),
    ]);

  const evidenceByContact = new Map<string, LeadDetail["contacts"][number]["evidence"]>();
  const evidenceByType = new Map<string, LeadDetail["contacts"][number]["evidence"]>();
  for (const evidence of evidenceRows) {
    const item = {
      id: evidence.id,
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

  const scanRow = scan[0];
  const scoreRow = scores[0];

  return {
    lead: {
      id: row.id,
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
      status: row.status as PipelineStatus,
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
      id: contact.id,
      type: contact.type,
      value: contact.value,
      normalizedValue: contact.normalizedValue,
      label: contact.label,
      platform: contact.platform,
      verifiedByUser: contact.verifiedByUser,
      confidence: contact.confidence,
      firstSeenAt: contact.firstSeenAt.toISOString(),
      lastSeenAt: contact.lastSeenAt.toISOString(),
      evidence: evidenceByContact.get(contact.id) ?? evidenceByType.get(contact.type) ?? [],
    })),
    latestScan: scanRow
      ? {
          id: scanRow.id,
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
          id: scoreRow.id,
          total: scoreRow.total,
          components: scoreRow.components,
          profileVersion: scoreRow.profileVersion,
          calculatedAt: scoreRow.calculatedAt.toISOString(),
        }
      : null,
    sources: sources.map((source) => ({
      id: source.id,
      source: source.source,
      sourceId: source.sourceId,
      attribution: source.attribution,
      createdAt: source.createdAt.toISOString(),
      importJobId: source.importJobId,
    })),
    activities: activityRows.map((activity) => ({
      id: activity.id,
      type: activity.type,
      message: activity.message,
      metadata: activity.metadata ?? null,
      createdAt: activity.createdAt.toISOString(),
    })),
    tags: tagRows,
    duplicates: duplicateRows,
    merges: mergeRows.map((merge) => ({
      id: merge.id,
      mergedBusinessId: merge.mergedBusinessId,
      createdAt: merge.createdAt.toISOString(),
      undoneAt: merge.undoneAt?.toISOString() ?? null,
    })),
  };
}

async function pendingDuplicates(workspaceId: string, businessId: string): Promise<LeadDetail["duplicates"]> {
  const a = alias(businesses, "a");
  const b = alias(businesses, "b");
  const rows = await db
    .select({
      id: duplicateCandidates.id,
      status: duplicateCandidates.status,
      similarity: duplicateCandidates.similarity,
      aId: duplicateCandidates.businessAId,
      bId: duplicateCandidates.businessBId,
      aName: a.name,
      bName: b.name,
    })
    .from(duplicateCandidates)
    .innerJoin(a, eq(a.id, duplicateCandidates.businessAId))
    .innerJoin(b, eq(b.id, duplicateCandidates.businessBId))
    .where(
      and(
        eq(duplicateCandidates.workspaceId, workspaceId),
        eq(duplicateCandidates.status, "pending"),
        or(eq(duplicateCandidates.businessAId, businessId), eq(duplicateCandidates.businessBId, businessId)),
      ),
    )
    .limit(20);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    similarity: row.similarity,
    otherId: row.aId === businessId ? row.bId : row.aId,
    otherName: row.aId === businessId ? row.bName : row.aName,
  }));
}
