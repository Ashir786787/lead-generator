import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, businessTags, duplicateCandidates, memberships, tags, user } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { labelFor } from "@/lib/normalize/category";
import type { CategoryKey } from "@/lib/score/types";
import { PIPELINE_STATUSES, type PipelineStatus } from "@/lib/constants";

export interface LeadFacets {
  cities: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; label: string; count: number }>;
  statuses: Array<{ value: PipelineStatus; count: number }>;
  tags: Array<{ id: string; name: string; color: string; count: number }>;
  members: Array<{ id: string; name: string; email: string; role: string }>;
}

export async function getLeadFacets(ctx: WorkspaceContext): Promise<LeadFacets> {
  const [cityRows, categoryRows, statusRows, tagRows, memberRows] = await Promise.all([
    db
      .select({ value: businesses.city, count: count() })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          isNull(businesses.archivedAt),
          isNotNull(businesses.city),
        ),
      )
      .groupBy(businesses.city)
      .orderBy(desc(count()), asc(businesses.city))
      .limit(150),
    db
      .select({ value: businesses.categoryKey, raw: businesses.category, count: count() })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          isNull(businesses.archivedAt),
          isNotNull(businesses.categoryKey),
        ),
      )
      .groupBy(businesses.categoryKey, businesses.category)
      .orderBy(desc(count()))
      .limit(100),
    db
      .select({ value: businesses.status, count: count() })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          isNull(businesses.archivedAt),
        ),
      )
      .groupBy(businesses.status),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color, count: count(businessTags.businessId) })
      .from(tags)
      .leftJoin(businessTags, and(eq(businessTags.tagId, tags.id), eq(businessTags.workspaceId, ctx.workspaceId)))
      .where(eq(tags.workspaceId, ctx.workspaceId))
      .groupBy(tags.id, tags.name, tags.color)
      .orderBy(desc(count(businessTags.businessId)), asc(tags.name))
      .limit(100),
    db
      .select({ id: user.id, name: user.name, email: user.email, role: memberships.role })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.workspaceId, ctx.workspaceId))
      .orderBy(asc(user.name)),
  ]);

  const mergedCategories = new Map<string, { label: string; count: number }>();
  for (const row of categoryRows) {
    if (!row.value) continue;
    const existing = mergedCategories.get(row.value);
    mergedCategories.set(row.value, {
      label: existing?.label ?? labelFor(row.value as CategoryKey),
      count: (existing?.count ?? 0) + Number(row.count),
    });
  }

  const statusMap = new Map(statusRows.map((row) => [row.value, Number(row.count)]));
  return {
    cities: cityRows
      .filter((row): row is { value: string; count: number } => Boolean(row.value))
      .map((row) => ({ value: row.value, count: Number(row.count) })),
    categories: [...mergedCategories.entries()]
      .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }))
      .sort((a, b) => b.count - a.count),
    statuses: PIPELINE_STATUSES.map((value) => ({ value, count: statusMap.get(value) ?? 0 })),
    tags: tagRows.map((row) => ({ ...row, count: Number(row.count) })),
    members: memberRows,
  };
}

export async function getWorkspaceOverview(ctx: WorkspaceContext): Promise<{
  total: number;
  fresh: number;
  reviewed: number;
  qualified: number;
  contacted: number;
  won: number;
  avgScore: number | null;
  withWebsite: number;
  checkedSuccess: number;
  chatbotDetected: number;
  chatbotNotDetected: number;
  chatbotUnknown: number;
  pendingDuplicates: number;
}> {
  const [rows, duplicateRows] = await Promise.all([
    db
      .select({
        total: count(),
        fresh: sql<number>`count(*) filter (where ${businesses.status} = 'new')`,
        reviewed: sql<number>`count(*) filter (where ${businesses.status} = 'reviewing')`,
        qualified: sql<number>`count(*) filter (where ${businesses.status} = 'qualified')`,
        contacted: sql<number>`count(*) filter (where ${businesses.status} in ('contacted','follow_up','proposal_sent'))`,
        won: sql<number>`count(*) filter (where ${businesses.status} = 'won')`,
        avgScore: sql<number | null>`avg(${businesses.latestScore})`,
        withWebsite: sql<number>`count(*) filter (where ${businesses.websiteHost} is not null)`,
        checkedSuccess: sql<number>`count(*) filter (where ${businesses.latestScanOutcome} = 'success')`,
        chatbotDetected: sql<number>`count(*) filter (where ${businesses.latestChatbotResult} = 'detected')`,
        chatbotNotDetected: sql<number>`count(*) filter (where ${businesses.latestChatbotResult} = 'not_detected')`,
        chatbotUnknown: sql<number>`count(*) filter (where ${businesses.latestChatbotResult} = 'unknown')`,
      })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          isNull(businesses.archivedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.workspaceId, ctx.workspaceId),
          eq(duplicateCandidates.status, "pending"),
        ),
      ),
  ]);
  const row = rows[0];
  const duplicateRow = duplicateRows[0];
  return {
    total: Number(row?.total ?? 0),
    fresh: Number(row?.fresh ?? 0),
    reviewed: Number(row?.reviewed ?? 0),
    qualified: Number(row?.qualified ?? 0),
    contacted: Number(row?.contacted ?? 0),
    won: Number(row?.won ?? 0),
    avgScore: row?.avgScore === null || row?.avgScore === undefined ? null : Math.round(Number(row.avgScore)),
    withWebsite: Number(row?.withWebsite ?? 0),
    checkedSuccess: Number(row?.checkedSuccess ?? 0),
    chatbotDetected: Number(row?.chatbotDetected ?? 0),
    chatbotNotDetected: Number(row?.chatbotNotDetected ?? 0),
    chatbotUnknown: Number(row?.chatbotUnknown ?? 0),
    pendingDuplicates: Number(duplicateRow?.value ?? 0),
  };
}
