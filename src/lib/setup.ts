import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

export interface SetupStatus {
  needsSetup: boolean;
  userCount: number;
  appName: string;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const [row] = await db.select({ value: count() }).from(user);
  const userCount = Number(row?.value ?? 0);
  return {
    needsSetup: userCount === 0,
    userCount,
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Lead Finder",
  };
}

export async function ownerHint(): Promise<string> {
  return process.env.OWNER_EMAIL ?? "";
}

/** True when the workspace row exists and is attached to at least one owner. */
export async function firstWorkspaceId(): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, user.id))
    .limit(1);
  return row?.id ?? null;
}
