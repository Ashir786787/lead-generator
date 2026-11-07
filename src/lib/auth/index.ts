import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { nanoid } from "nanoid";
import { collections, mongoClient, mongoDb, newId, now } from "@/lib/db";
import { env, assertSafeConfig } from "@/lib/env";
import { ensureDefaultProfile } from "@/lib/score/service";

assertSafeConfig();

async function userCount(): Promise<number> {
  return collections.user.countDocuments();
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
  const workspaceId = newId();
  const timestamp = now();
  await collections.workspaces.insertOne({
    _id: workspaceId,
    name: workspaceName.slice(0, 120),
    slug: slugFor(workspaceName),
    isDemo: false,
    timezone: env.defaultTimezone,
    countryNotes: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await collections.memberships.insertOne({
    _id: newId(),
    workspaceId,
    userId,
    role: "owner",
    createdAt: timestamp,
  });
  await ensureDefaultProfile(workspaceId, userId);
  void email;
}

export const auth = betterAuth({
  appName: env.appName,
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  trustedOrigins: [env.appUrl, env.betterAuthUrl],
  database: mongodbAdapter(mongoDb, { client: mongoClient, transaction: false }),
  advanced: {
    database: {
      // Keep the app's string UUID ids instead of the adapter's ObjectId
      // coercion, so every workspace/user reference stays a plain string.
      generateId: () => newId(),
    },
  },
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
