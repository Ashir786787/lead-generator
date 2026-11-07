import { collections } from "@/lib/db";
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

const baseMatch = (workspaceId: string) => ({
  workspaceId,
  mergedIntoId: null,
  archivedAt: null,
});

export async function getLeadFacets(ctx: WorkspaceContext): Promise<LeadFacets> {
  const [cityRows, categoryRows, statusRows, tagRows, memberRows] = await Promise.all([
    collections.businesses
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...baseMatch(ctx.workspaceId), city: { $ne: null } } },
        { $group: { _id: "$city", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 150 },
      ])
      .toArray(),
    collections.businesses
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...baseMatch(ctx.workspaceId), categoryKey: { $ne: null } } },
        { $group: { _id: "$categoryKey", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 100 },
      ])
      .toArray(),
    collections.businesses
      .aggregate<{ _id: PipelineStatus; count: number }>([
        { $match: baseMatch(ctx.workspaceId) },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray(),
    collections.tags.find({ workspaceId: ctx.workspaceId }).sort({ name: 1 }).limit(100).toArray(),
    collections.memberships.find({ workspaceId: ctx.workspaceId }).toArray(),
  ]);

  const tagCounts = tagRows.length
    ? await collections.businessTags
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              workspaceId: ctx.workspaceId,
              tagId: { $in: tagRows.map((tag) => tag._id) },
            },
          },
          { $group: { _id: "$tagId", count: { $sum: 1 } } },
        ])
        .toArray()
    : [];
  const countByTag = new Map(tagCounts.map((row) => [row._id, row.count]));

  const memberIds = memberRows.map((row) => row.userId);
  const users = memberIds.length
    ? await collections.user
        .find({ _id: { $in: memberIds } }, { projection: { _id: 1, name: 1, email: 1 } })
        .toArray()
    : [];
  const userById = new Map(users.map((user) => [user._id, user]));

  const statusMap = new Map(statusRows.map((row) => [row._id, row.count]));

  return {
    cities: cityRows
      .filter((row): row is { _id: string; count: number } => Boolean(row._id))
      .map((row) => ({ value: row._id, count: row.count })),
    categories: categoryRows
      .filter((row) => Boolean(row._id))
      .map((row) => ({
        value: row._id,
        label: labelFor(row._id as CategoryKey),
        count: row.count,
      })),
    statuses: PIPELINE_STATUSES.map((value) => ({
      value,
      count: statusMap.get(value) ?? 0,
    })),
    tags: tagRows
      .map((tag) => ({
        id: tag._id,
        name: tag.name,
        color: tag.color,
        count: countByTag.get(tag._id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    members: memberRows
      .flatMap((membership) => {
        const user = userById.get(membership.userId);
        if (!user) return [];
        return [
          {
            id: user._id,
            name: user.name,
            email: user.email,
            role: membership.role as string,
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
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
  const [overviewRows, pendingDuplicates] = await Promise.all([
    collections.businesses
      .aggregate<{
        _id: null;
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
      }>([
        { $match: baseMatch(ctx.workspaceId) },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            fresh: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
            reviewed: { $sum: { $cond: [{ $eq: ["$status", "reviewing"] }, 1, 0] } },
            qualified: { $sum: { $cond: [{ $eq: ["$status", "qualified"] }, 1, 0] } },
            contacted: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["contacted", "follow_up", "proposal_sent"]] },
                  1,
                  0,
                ],
              },
            },
            won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
            avgScore: { $avg: "$latestScore" },
            withWebsite: { $sum: { $cond: [{ $ne: ["$websiteHost", null] }, 1, 0] } },
            checkedSuccess: {
              $sum: { $cond: [{ $eq: ["$latestScanOutcome", "success"] }, 1, 0] },
            },
            chatbotDetected: {
              $sum: { $cond: [{ $eq: ["$latestChatbotResult", "detected"] }, 1, 0] },
            },
            chatbotNotDetected: {
              $sum: { $cond: [{ $eq: ["$latestChatbotResult", "not_detected"] }, 1, 0] },
            },
            chatbotUnknown: {
              $sum: { $cond: [{ $eq: ["$latestChatbotResult", "unknown"] }, 1, 0] },
            },
          },
        },
      ])
      .toArray(),
    collections.duplicateCandidates.countDocuments({
      workspaceId: ctx.workspaceId,
      status: "pending",
    }),
  ]);

  const row = overviewRows[0];
  return {
    total: row?.total ?? 0,
    fresh: row?.fresh ?? 0,
    reviewed: row?.reviewed ?? 0,
    qualified: row?.qualified ?? 0,
    contacted: row?.contacted ?? 0,
    won: row?.won ?? 0,
    avgScore:
      row?.avgScore === null || row?.avgScore === undefined
        ? null
        : Math.round(Number(row.avgScore)),
    withWebsite: row?.withWebsite ?? 0,
    checkedSuccess: row?.checkedSuccess ?? 0,
    chatbotDetected: row?.chatbotDetected ?? 0,
    chatbotNotDetected: row?.chatbotNotDetected ?? 0,
    chatbotUnknown: row?.chatbotUnknown ?? 0,
    pendingDuplicates,
  };
}
