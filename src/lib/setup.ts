import { collections } from "@/lib/db";

export interface SetupStatus {
  needsSetup: boolean;
  userCount: number;
  appName: string;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const userCount = await collections.user.countDocuments();
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
  const row = await collections.user.findOne({}, { projection: { _id: 1 } });
  return row?._id ?? null;
}
