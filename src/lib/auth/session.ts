import { cache } from "react";
import { cookies, headers } from "next/headers";
import { collections } from "@/lib/db";
import type { MembershipDoc, WorkspaceDoc } from "@/lib/db/types";
import { auth } from "@/lib/auth";
import { WORKSPACE_COOKIE } from "@/lib/constants";
import { unauthorized, forbidden } from "@/lib/api/errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  role: "owner" | "member";
}

export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  isDemo: boolean;
  role: "owner" | "member";
  timezone: string;
  countryNotes: Record<string, string>;
  workspaces: WorkspaceSummary[];
}

interface WorkspaceRow extends WorkspaceDoc {
  role: "owner" | "member";
}

async function workspaceRowsForUser(userId: string): Promise<WorkspaceRow[]> {
  const memberships = await collections.memberships.find({ userId }).toArray();
  if (memberships.length === 0) return [];
  const workspaceIds = memberships.map((membership) => membership.workspaceId);
  const workspaces = await collections.workspaces
    .find({ _id: { $in: workspaceIds } })
    .toArray();
  const byId = new Map(workspaces.map((workspace) => [workspace._id, workspace]));
  const rows: WorkspaceRow[] = [];
  for (const membership of memberships as MembershipDoc[]) {
    const workspace = byId.get(membership.workspaceId);
    if (workspace) rows.push({ ...workspace, role: membership.role });
  }
  return rows.sort(
    (a, b) =>
      Number(a.isDemo) - Number(b.isDemo) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
});

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await workspaceRowsForUser(userId);
  return rows.map((row) => ({
    id: row._id,
    name: row.name,
    slug: row.slug,
    isDemo: row.isDemo,
    role: row.role,
  }));
}

/**
 * The only way route handlers / pages obtain a workspace. Every data-access
 * function requires the returned workspaceId, so an unscoped query is a type error.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw unauthorized();

  const rows = await workspaceRowsForUser(sessionUser.id);
  if (rows.length === 0) {
    throw forbidden("Your account is not attached to a workspace. Run the first-run setup again.");
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const active = rows.find((row) => row._id === requested) ?? rows[0];
  if (!active) throw forbidden("No workspace available.");

  return {
    user: sessionUser,
    workspaceId: active._id,
    workspaceName: active.name,
    workspaceSlug: active.slug,
    isDemo: active.isDemo,
    role: active.role,
    timezone: active.timezone,
    countryNotes: active.countryNotes ?? {},
    workspaces: rows.map((row) => ({
      id: row._id,
      name: row.name,
      slug: row.slug,
      isDemo: row.isDemo,
      role: row.role,
    })),
  };
});

export async function assertWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
  const row = await collections.memberships.findOne({ userId, workspaceId });
  if (!row) throw forbidden();
}
