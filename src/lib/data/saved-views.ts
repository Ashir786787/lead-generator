import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { savedViews } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound } from "@/lib/api/errors";

export interface SavedView {
  id: string;
  name: string;
  query: Record<string, string>;
  createdAt: string;
}

function toView(row: typeof savedViews.$inferSelect): SavedView {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSavedViews(ctx: WorkspaceContext): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.workspaceId, ctx.workspaceId), eq(savedViews.userId, ctx.user.id)))
    .orderBy(asc(savedViews.createdAt));
  return rows.map(toView);
}

export async function createSavedView(
  ctx: WorkspaceContext,
  name: string,
  query: Record<string, string>,
): Promise<SavedView> {
  const [row] = await db
    .insert(savedViews)
    .values({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      name: name.trim().slice(0, 80),
      query,
    })
    .returning();
  if (!row) throw new Error("Could not save this view.");
  return toView(row);
}

export async function deleteSavedView(ctx: WorkspaceContext, id: string): Promise<void> {
  const deleted = await db
    .delete(savedViews)
    .where(
      and(
        eq(savedViews.workspaceId, ctx.workspaceId),
        eq(savedViews.userId, ctx.user.id),
        eq(savedViews.id, id),
      ),
    )
    .returning({ id: savedViews.id });
  if (!deleted.length) throw notFound("Saved view not found.");
}
