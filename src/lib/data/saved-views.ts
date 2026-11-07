import { collections, newId, now } from "@/lib/db";
import type { SavedViewDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound } from "@/lib/api/errors";

export interface SavedView {
  id: string;
  name: string;
  query: Record<string, string>;
  createdAt: string;
}

function toView(row: SavedViewDoc): SavedView {
  return {
    id: row._id,
    name: row.name,
    query: row.query,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSavedViews(ctx: WorkspaceContext): Promise<SavedView[]> {
  const rows = await collections.savedViews
    .find({ workspaceId: ctx.workspaceId, userId: ctx.user.id })
    .sort({ createdAt: 1 })
    .toArray();
  return rows.map(toView);
}

export async function createSavedView(
  ctx: WorkspaceContext,
  name: string,
  query: Record<string, string>,
): Promise<SavedView> {
  const row: SavedViewDoc = {
    _id: newId(),
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    name: name.trim().slice(0, 80),
    query,
    createdAt: now(),
  };
  await collections.savedViews.insertOne(row);
  return toView(row);
}

export async function deleteSavedView(ctx: WorkspaceContext, id: string): Promise<void> {
  const result = await collections.savedViews.deleteOne({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    _id: id,
  });
  if (result.deletedCount === 0) throw notFound("Saved view not found.");
}
