import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeMongo, collections, now } from "@/lib/db";
import { ensureIndexes } from "@/lib/db/indexes";
import type {
  BusinessDoc,
  DuplicateCandidateDoc,
  MembershipDoc,
  NoteDoc,
  TagDoc,
  UserDoc,
  WorkspaceDoc,
} from "@/lib/db/types";
import { nameTokens } from "@/lib/normalize";
import type { WorkspaceContext } from "@/lib/auth/session";
import { leadQuerySchema } from "@/lib/data/filters";
import { getLeadDetail, listLeads } from "@/lib/data/leads";
import { bulkArchive, updateLead } from "@/lib/data/mutations";
import { findBestMatch, resolveDuplicate, undoLastMerge } from "@/lib/dedupe/service";

function context(workspaceId: string, userId: string, slug: string): WorkspaceContext {
  return {
    user: { id: userId, email: `${slug}@example.test`, name: slug },
    workspaceId,
    workspaceName: slug,
    workspaceSlug: slug,
    isDemo: false,
    role: "owner",
    timezone: "UTC",
    countryNotes: {},
    workspaces: [],
  };
}

function business(
  overrides: Partial<BusinessDoc> & {
    _id: string;
    workspaceId: string;
    name: string;
    normalizedName: string;
  },
): BusinessDoc {
  const timestamp = now();
  return {
    nameTokens: nameTokens(overrides.normalizedName),
    category: null,
    categoryKey: null,
    phone: null,
    phoneE164: null,
    email: null,
    emailNormalized: null,
    websiteUrl: null,
    websiteHost: null,
    street: null,
    area: null,
    city: null,
    country: null,
    lat: null,
    lng: null,
    status: "new",
    ownerId: null,
    doNotContact: false,
    followUpAt: null,
    notes: null,
    fieldLocks: [],
    latestScore: null,
    latestScoreResultId: null,
    latestScanId: null,
    latestScanOutcome: null,
    latestChatbotResult: null,
    lastCheckedAt: null,
    isDemo: false,
    hasWhatsapp: false,
    mergedIntoId: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const runId = randomUUID().slice(0, 8);
const userAId = randomUUID();
const userBId = randomUUID();
const workspaceAId = randomUUID();
const workspaceBId = randomUUID();
const leadAId = randomUUID();
const leadBId = randomUUID();

let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;

beforeAll(async () => {
  await ensureIndexes();
  const timestamp = now();

  const users: UserDoc[] = [
    {
      _id: userAId,
      name: "Owner A",
      email: `owner-a-${runId}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      _id: userBId,
      name: "Owner B",
      email: `owner-b-${runId}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  await collections.user.insertMany(users);

  const workspaces: WorkspaceDoc[] = [
    {
      _id: workspaceAId,
      name: `Workspace A ${runId}`,
      slug: `workspace-a-${runId}`,
      isDemo: false,
      timezone: "UTC",
      countryNotes: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      _id: workspaceBId,
      name: `Workspace B ${runId}`,
      slug: `workspace-b-${runId}`,
      isDemo: false,
      timezone: "UTC",
      countryNotes: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  await collections.workspaces.insertMany(workspaces);

  const memberships: MembershipDoc[] = [
    { _id: randomUUID(), workspaceId: workspaceAId, userId: userAId, role: "owner", createdAt: timestamp },
    { _id: randomUUID(), workspaceId: workspaceBId, userId: userBId, role: "owner", createdAt: timestamp },
  ];
  await collections.memberships.insertMany(memberships);

  await collections.businesses.insertMany([
    business({
      _id: leadAId,
      workspaceId: workspaceAId,
      name: "Alpha Dental Studio",
      normalizedName: "alpha dental studio",
      city: "Dubai",
      categoryKey: "dentist",
    }),
    business({
      _id: leadBId,
      workspaceId: workspaceBId,
      name: "Beta Legal Advisors",
      normalizedName: "beta legal advisors",
      city: "Dubai",
      categoryKey: "law_firm",
    }),
  ]);

  ctxA = context(workspaceAId, userAId, `workspace-a-${runId}`);
  ctxB = context(workspaceBId, userBId, `workspace-b-${runId}`);
});

afterAll(async () => {
  await Promise.all([
    collections.businesses.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.businessTags.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.notes.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.tags.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.duplicateCandidates.deleteMany({
      workspaceId: { $in: [workspaceAId, workspaceBId] },
    }),
    collections.mergeHistory.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.activities.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.memberships.deleteMany({ workspaceId: { $in: [workspaceAId, workspaceBId] } }),
    collections.workspaces.deleteMany({ _id: { $in: [workspaceAId, workspaceBId] } }),
    collections.user.deleteMany({ _id: { $in: [userAId, userBId] } }),
  ]);
  await closeMongo();
});

describe("index invariants", () => {
  it("indexes lead reads by workspace", async () => {
    const names = (await collections.businesses.indexes()).map((index) => index.name);
    expect(names).toContain("workspaceId_1_createdAt_-1");
    expect(names).toContain("workspaceId_1_normalizedName_1");
    expect(names).toContain("workspaceId_1_websiteHost_1");
    expect(names).toContain("workspaceId_1_phoneE164_1");
  });
});

describe("workspace isolation", () => {
  it("scopes list reads to the active workspace", async () => {
    const query = leadQuerySchema.parse({});
    const resultA = await listLeads(ctxA, query);
    expect(resultA.total).toBe(1);
    expect(resultA.items.map((lead) => lead.id)).toEqual([leadAId]);

    const resultB = await listLeads(ctxB, query);
    expect(resultB.total).toBe(1);
    expect(resultB.items.map((lead) => lead.id)).toEqual([leadBId]);
  });

  it("does not leak another workspace's lead through search", async () => {
    const query = leadQuerySchema.parse({ q: "Beta Legal" });
    const result = await listLeads(ctxA, query);
    expect(result.total).toBe(0);
  });

  it("refuses to read a lead owned by another workspace", async () => {
    await expect(getLeadDetail(ctxA, leadBId)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(getLeadDetail(ctxB, leadAId)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("refuses to mutate a lead owned by another workspace", async () => {
    await expect(
      updateLead(ctxA, leadBId, { status: "qualified", notes: "hijacked" }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });

    const row = await collections.businesses.findOne({ _id: leadBId });
    expect(row?.status).toBe("new");
    expect(row?.notes).toBeNull();
  });

  it("does not archive another workspace's leads in a bulk action", async () => {
    const count = await bulkArchive(ctxA, [leadBId]);
    expect(count).toBe(0);

    const row = await collections.businesses.findOne({ _id: leadBId });
    expect(row?.archivedAt).toBeNull();
  });

  it("allows mutations inside the active workspace", async () => {
    await updateLead(ctxA, leadAId, { status: "qualified", notes: "called on Tuesday" });

    const detail = await getLeadDetail(ctxA, leadAId);
    expect(detail.lead.status).toBe("qualified");
    expect(detail.lead.notes).toBe("called on Tuesday");

    const rowB = await collections.businesses.findOne({ _id: leadBId });
    expect(rowB?.status).toBe("new");
  });

  it("matches duplicates by host and filters leads by scan outcome", async () => {
    await collections.businesses.updateOne(
      { _id: leadAId },
      {
        $set: {
          websiteHost: "alpha-dental.example",
          street: "12 Test Road",
          latestScanOutcome: "success",
        },
      },
    );

    const match = await findBestMatch(workspaceAId, {
      name: "Alpha Dental Studio",
      phoneE164: null,
      websiteHost: "www.alpha-dental.example",
      street: "12 Test Road",
      lat: null,
      lng: null,
    });
    expect(match?.candidateId).toBe(leadAId);

    const matching = await listLeads(ctxA, leadQuerySchema.parse({ scanOutcome: "success,partial" }));
    expect(matching.items.map((lead) => lead.id)).toEqual([leadAId]);

    const none = await listLeads(ctxA, leadQuerySchema.parse({ scanOutcome: "timeout" }));
    expect(none.total).toBe(0);
  });

  it("merges a duplicate and undoes it without losing notes or tags", async () => {
    const tagId = randomUUID();
    const noteId = randomUUID();
    const duplicateId = randomUUID();
    const timestamp = now();

    await collections.businesses.insertOne(
      business({
        _id: duplicateId,
        workspaceId: workspaceAId,
        name: "Alpha Dental Studio (dup)",
        normalizedName: "alpha dental studio dup",
        city: "Dubai",
        categoryKey: "dentist",
      }),
    );

    const tag: TagDoc = {
      _id: tagId,
      workspaceId: workspaceAId,
      name: `priority-${runId}`,
      color: "primary",
      createdAt: timestamp,
    };
    await collections.tags.insertOne(tag);
    await collections.businessTags.insertOne({
      _id: `${duplicateId}:${tagId}`,
      workspaceId: workspaceAId,
      businessId: duplicateId,
      tagId,
    });
    const note: NoteDoc = {
      _id: noteId,
      workspaceId: workspaceAId,
      businessId: duplicateId,
      body: "Merged note",
      authorId: userAId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await collections.notes.insertOne(note);

    const pair: DuplicateCandidateDoc = {
      _id: randomUUID(),
      workspaceId: workspaceAId,
      businessAId: leadAId,
      businessBId: duplicateId,
      similarity: 1,
      distanceM: null,
      reasons: ["test pair"],
      status: "pending",
      createdAt: timestamp,
      resolvedAt: null,
      resolvedBy: null,
    };
    await collections.duplicateCandidates.insertOne(pair);

    await resolveDuplicate(ctxA, pair._id, "merge", "a");

    const merged = await collections.businesses.findOne({ _id: duplicateId });
    expect(merged?.mergedIntoId).toBe(leadAId);
    const movedNote = await collections.notes.findOne({ _id: noteId });
    expect(movedNote?.businessId).toBe(leadAId);

    await undoLastMerge(ctxA);

    const restored = await collections.businesses.findOne({ _id: duplicateId });
    expect(restored?.mergedIntoId).toBeNull();
    const restoredNote = await collections.notes.findOne({ _id: noteId });
    expect(restoredNote?.businessId).toBe(duplicateId);
    const tagLinks = await collections.businessTags
      .find({ workspaceId: workspaceAId, tagId })
      .toArray();
    expect(tagLinks).toHaveLength(1);
    expect(tagLinks[0]?.businessId).toBe(duplicateId);
  });
});
