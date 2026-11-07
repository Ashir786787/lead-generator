import { hashPassword } from "better-auth/crypto";
import { collections, newId, now, withTransaction } from "@/lib/db";
import type { AccountDoc, ScoreProfileDoc, UserDoc, WorkspaceDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { assertWorkspaceMembership } from "@/lib/auth/session";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { PROFILE_NAME } from "@/lib/score/service";
import { cloneDefaultConfig } from "@/lib/score/config";

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

export type MemberDestination = "shared" | "personal";

export interface AddedWorkspaceMember {
  id: string;
  name: string;
  email: string;
  /** True when the account did not exist and was created for this workspace. */
  created: boolean;
  /** True when an existing account's password was updated. */
  passwordUpdated: boolean;
  destination: MemberDestination;
  /** True when a new personal workspace had to be created for them. */
  personalWorkspaceCreated: boolean;
}

/**
 * Adds someone to the workspace, creating their account when needed and setting
 * the password the owner types in. Two destinations are supported:
 *   - "shared":   they join the current workspace as a regular member.
 *   - "personal": they keep/own their own workspace and get no access to yours.
 *     A fresh personal workspace (with its default scoring profile) is created
 *     for them when they don't own one yet.
 *
 * Setting a password for an existing account is treated as a deliberate reset:
 * the credential password is updated and every existing session for that account
 * is revoked. Owner accounts cannot be created from the UI.
 */
export async function addWorkspaceMember(
  ctx: WorkspaceContext,
  input: { email: string; password: string; name?: string; destination?: MemberDestination },
): Promise<AddedWorkspaceMember> {
  if (ctx.role !== "owner") throw forbidden("Only a workspace owner can add members.");

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw conflict("Enter a valid email address.");
  const password = input.password ?? "";
  if (password.length < 8) throw conflict("Use at least 8 characters for the password.");
  if (password.length > 128) throw conflict("That password is too long (maximum 128 characters).");
  const destination: MemberDestination = input.destination ?? "shared";

  const timestamp = now();
  const passwordHash = await hashPassword(password);
  const name = (input.name ?? "").trim().slice(0, 120) || email.split("@")[0]!.slice(0, 80);

  return withTransaction(async (session) => {
    let user = await collections.user.findOne({ email }, { session });
    let created = false;

    if (!user) {
      const userId = newId();
      const newUser: UserDoc = {
        _id: userId,
        name,
        email,
        emailVerified: true,
        image: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await collections.user.insertOne(newUser, { session });
      const account: AccountDoc = {
        _id: newId(),
        accountId: userId,
        providerId: "credential",
        userId,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: passwordHash,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await collections.account.insertOne(account, { session });
      user = newUser;
      created = true;
    } else {
      const credential = await collections.account.findOne(
        { userId: user._id, providerId: "credential" },
        { session },
      );
      if (credential) {
        await collections.account.updateOne(
          { _id: credential._id },
          { $set: { password: passwordHash, updatedAt: timestamp } },
          { session },
        );
      } else {
        await collections.account.insertOne(
          {
            _id: newId(),
            accountId: user._id,
            providerId: "credential",
            userId: user._id,
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            scope: null,
            password: passwordHash,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          { session },
        );
      }
      // Revoke the old password everywhere it was used.
      await collections.session.deleteMany({ userId: user._id }, { session });
    }

    if (destination === "shared") {
      const existing = await collections.memberships.findOne(
        { workspaceId: ctx.workspaceId, userId: user._id },
        { session },
      );
      if (!existing) {
        await collections.memberships.insertOne(
          {
            _id: newId(),
            workspaceId: ctx.workspaceId,
            userId: user._id,
            role: "member",
            createdAt: timestamp,
          },
          { session },
        );
      }
      return {
        id: user._id,
        name: user.name,
        email: user.email,
        created,
        passwordUpdated: !created,
        destination: "shared",
        personalWorkspaceCreated: false,
      };
    }

    // Personal workspace: reuse one they already own, or create a fresh one.
    const owned = await collections.memberships.findOne(
      { userId: user._id, role: "owner" },
      { session },
    );
    if (owned) {
      return {
        id: user._id,
        name: user.name,
        email: user.email,
        created,
        passwordUpdated: !created,
        destination: "personal",
        personalWorkspaceCreated: false,
      };
    }

    const personalWorkspaceId = newId();
    const workspace: WorkspaceDoc = {
      _id: personalWorkspaceId,
      name: `${user.name}'s workspace`.slice(0, 120),
      slug: `u-${personalWorkspaceId.slice(0, 8)}`,
      isDemo: false,
      timezone: ctx.timezone ?? "UTC",
      countryNotes: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await collections.workspaces.insertOne(workspace, { session });
    await collections.memberships.insertOne(
      {
        _id: newId(),
        workspaceId: personalWorkspaceId,
        userId: user._id,
        role: "owner",
        createdAt: timestamp,
      },
      { session },
    );
    const profile: ScoreProfileDoc = {
      _id: newId(),
      workspaceId: personalWorkspaceId,
      name: PROFILE_NAME,
      version: 1,
      isActive: true,
      config: cloneDefaultConfig(),
      createdAt: timestamp,
      createdBy: user._id,
    };
    await collections.scoreProfiles.insertOne(profile, { session });

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      created,
      passwordUpdated: !created,
      destination: "personal",
      personalWorkspaceCreated: true,
    };
  });
}

export async function switchWorkspace(ctx: WorkspaceContext, workspaceId: string): Promise<void> {
  await assertWorkspaceMembership(ctx.user.id, workspaceId);
}
