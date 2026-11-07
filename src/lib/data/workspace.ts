import { collections, newId, now } from "@/lib/db";
import type { WorkspaceDoc } from "@/lib/db/types";
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
  const workspace = await collections.workspaces.findOne({ _id: ctx.workspaceId });
  if (!workspace) throw notFound("Workspace not found.");

  const memberships = await collections.memberships
    .find({ workspaceId: ctx.workspaceId })
    .sort({ createdAt: 1 })
    .toArray();
  const users = memberships.length
    ? await collections.user
        .find(
          { _id: { $in: memberships.map((membership) => membership.userId) } },
          { projection: { _id: 1, name: 1, email: 1 } },
        )
        .toArray()
    : [];
  const userById = new Map(users.map((user) => [user._id, user]));

  return {
    id: workspace._id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    isDemo: workspace.isDemo,
    countryNotes: workspace.countryNotes ?? {},
    members: memberships.flatMap((membership) => {
      const user = userById.get(membership.userId);
      if (!user) return [];
      return [
        {
          id: user._id,
          name: user.name,
          email: user.email,
          role: membership.role,
          joinedAt: membership.createdAt.toISOString(),
        },
      ];
    }),
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
  const updates: Partial<WorkspaceDoc> = { updatedAt: now() };
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
  await collections.workspaces.updateOne({ _id: ctx.workspaceId }, { $set: updates });
}

export async function addWorkspaceMember(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ id: string; name: string; email: string }> {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can add members.");
  const normalized = email.trim().toLowerCase();
  const target = await collections.user.findOne(
    { email: normalized },
    { projection: { _id: 1, name: 1, email: 1 } },
  );
  if (!target) {
    throw conflict("No account uses that email yet. Ask them to create an account first.");
  }
  const existing = await collections.memberships.findOne({
    workspaceId: ctx.workspaceId,
    userId: target._id,
  });
  if (existing) throw conflict("That person is already a member of this workspace.");
  await collections.memberships.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
    userId: target._id,
    role: "member",
    createdAt: now(),
  });
  return { id: target._id, name: target.name, email: target.email };
}

export async function switchWorkspace(ctx: WorkspaceContext, workspaceId: string): Promise<void> {
  await assertWorkspaceMembership(ctx.user.id, workspaceId);
}
