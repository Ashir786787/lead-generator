import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { account, memberships, session, user, verification, workspaces } from "@/lib/db/schema";
import { env, assertSafeConfig } from "@/lib/env";
import { ensureDefaultProfile } from "@/lib/score/service";

assertSafeConfig();

async function userCount(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(user);
  return Number(row?.value ?? 0);
}

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${nanoid(6).toLowerCase()}`;
}

async function createWorkspaceForUser(userId: string, name: string, email: string): Promise<void> {
  const workspaceName = name.trim() ? `${name.trim()}'s workspace` : "My workspace";
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: workspaceName.slice(0, 120),
      slug: slugFor(workspaceName),
      isDemo: false,
      timezone: env.defaultTimezone,
    })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("Could not create the workspace.");
  await db.insert(memberships).values({ workspaceId: workspace.id, userId, role: "owner" });
  await ensureDefaultProfile(workspace.id, userId);
  void email;
}

export const auth = betterAuth({
  appName: env.appName,
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  trustedOrigins: [env.appUrl, env.betterAuthUrl],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  plugins: [nextCookies()],
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          const existing = await userCount();
          if (existing >= 1 && !env.allowSignup) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is disabled. Ask the workspace owner for access.",
            });
          }
          return { data: newUser };
        },
        after: async (newUser) => {
          try {
            await createWorkspaceForUser(newUser.id, newUser.name, newUser.email);
          } catch (error) {
            console.error("Could not create a workspace for the new user", error);
          }
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

