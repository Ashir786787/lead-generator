import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberships, user, workspaces } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { assertWorkspaceMembership } from "@/lib/auth/session";
import { conflict, forbidden, notFound } from "@/lib/api/errors";

export interface WorkspaceSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isDemo: boolean;
  countryNotes: Record<string, string>;
  members: Array<{ id: string; name: string; email: string; role: "owner" | "member"; joinedAt: string }>;
}

export async function getWorkspaceSettings(ctx: WorkspaceContext): Promise<WorkspaceSettings> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!workspace) throw notFound("Workspace not found.");

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.workspaceId, ctx.workspaceId))
    .orderBy(asc(memberships.createdAt));

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    isDemo: workspace.isDemo,
    countryNotes: workspace.countryNotes ?? {},
    members: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.createdAt.toISOString(),
    })),
  };
}

export async function updateWorkspaceSettings(
  ctx: WorkspaceContext,
  patch: {
    name?: string;
    timezone?: string;
    countryNotes?: Record<string, string>;
  },
): Promise<void> {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can change these settings.");
  const updates: Partial<typeof workspaces.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (!name) throw conflict("The workspace name cannot be empty.");
    updates.name = name;
  }
  if (patch.timezone !== undefined) {
    const timezone = patch.timezone.trim();
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    } catch {
      throw conflict("Choose a valid IANA timezone such as Europe/London.");
    }
    updates.timezone = timezone;
  }
  if (patch.countryNotes !== undefined) updates.countryNotes = patch.countryNotes;
  await db.update(workspaces).set(updates).where(eq(workspaces.id, ctx.workspaceId));
}

export async function addWorkspaceMember(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ id: string; name: string; email: string }> {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can add members.");
  const normalized = email.trim().toLowerCase();
  const [target] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.email, normalized)).limit(1);
  if (!target) {
    throw conflict("No account uses that email yet. Ask them to create an account first.");
  }
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, target.id)))
    .limit(1);
  if (existing) throw conflict("That person is already a member of this workspace.");
  await db.insert(memberships).values({ workspaceId: ctx.workspaceId, userId: target.id, role: "member" });
  return target;
}

export async function switchWorkspace(ctx: WorkspaceContext, workspaceId: string): Promise<void> {
  await assertWorkspaceMembership(ctx.user.id, workspaceId);
}
