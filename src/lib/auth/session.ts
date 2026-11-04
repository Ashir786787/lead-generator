import { cookies, headers } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberships, workspaces } from "@/lib/db/schema";
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

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      isDemo: workspaces.isDemo,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.isDemo), asc(workspaces.createdAt));
  return rows.map((row) => ({
    id: row.id,
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
export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw unauthorized();

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      isDemo: workspaces.isDemo,
      timezone: workspaces.timezone,
      countryNotes: workspaces.countryNotes,
      role: memberships.role,
      createdAt: workspaces.createdAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, sessionUser.id))
    .orderBy(asc(workspaces.isDemo), asc(workspaces.createdAt));

  if (rows.length === 0) {
    throw forbidden("Your account is not attached to a workspace. Run the first-run setup again.");
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const active = rows.find((row) => row.id === requested) ?? rows[0];
  if (!active) throw forbidden("No workspace available.");

  return {
    user: sessionUser,
    workspaceId: active.id,
    workspaceName: active.name,
    workspaceSlug: active.slug,
    isDemo: active.isDemo,
    role: active.role,
    timezone: active.timezone,
    countryNotes: active.countryNotes ?? {},
    workspaces: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isDemo: row.isDemo,
      role: row.role,
    })),
  };
}

export async function assertWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw forbidden();
}
