import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  businesses,
  businessTags,
  duplicateCandidates,
  memberships,
  notes,
  tags,
  user,
  workspaces,
} from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { leadQuerySchema } from "@/lib/data/filters";
import { getLeadDetail, listLeads } from "@/lib/data/leads";
import { bulkArchive, updateLead } from "@/lib/data/mutations";
import { findBestMatch, resolveDuplicate, undoLastMerge } from "@/lib/dedupe/service";

interface WorkspaceColumn {
  name: string;
  notNull: boolean;
}

function hasWorkspaceColumn(
  value: unknown,
): value is { workspaceId: WorkspaceColumn } {
  return typeof value === "object" && value !== null && "workspaceId" in value;
}

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
  await db.insert(user).values([
    { id: userAId, name: "Owner A", email: `owner-a-${runId}@example.test` },
    { id: userBId, name: "Owner B", email: `owner-b-${runId}@example.test` },
  ]);
  await db.insert(workspaces).values([
    { id: workspaceAId, name: `Workspace A ${runId}`, slug: `workspace-a-${runId}` },
    { id: workspaceBId, name: `Workspace B ${runId}`, slug: `workspace-b-${runId}` },
  ]);
  await db.insert(memberships).values([
    { workspaceId: workspaceAId, userId: userAId, role: "owner" },
    { workspaceId: workspaceBId, userId: userBId, role: "owner" },
  ]);
  await db.insert(businesses).values([
    {
      id: leadAId,
      workspaceId: workspaceAId,
      name: "Alpha Dental Studio",
      normalizedName: "alpha dental studio",
      city: "Dubai",
      categoryKey: "dentist",
    },
    {
      id: leadBId,
      workspaceId: workspaceBId,
      name: "Beta Legal Advisors",
      normalizedName: "beta legal advisors",
      city: "Dubai",
      categoryKey: "law_firm",
    },
  ]);

  ctxA = context(workspaceAId, userAId, `workspace-a-${runId}`);
  ctxB = context(workspaceBId, userBId, `workspace-b-${runId}`);
});

afterAll(async () => {
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceAId, workspaceBId]));
  await db.delete(user).where(inArray(user.id, [userAId, userBId]));
  await pool.end();
});

describe("workspace schema invariants", () => {
  it("gives every workspace-owned table a NOT NULL workspace_id", () => {
    const owned: Array<[string, { workspaceId: WorkspaceColumn }]> = [];
    for (const [name, value] of Object.entries(schema)) {
      if (hasWorkspaceColumn(value)) owned.push([name, value]);
    }

    expect(owned.length).toBe(22);
    for (const [name, table] of owned) {
      expect(table.workspaceId.name, name).toBe("workspace_id");
      expect(table.workspaceId.notNull, name).toBe(true);
    }
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

    const [row] = await db.select().from(businesses).where(eq(businesses.id, leadBId));
    expect(row?.status).toBe("new");
    expect(row?.notes).toBeNull();
  });

  it("does not archive another workspace's leads in a bulk action", async () => {
    const count = await bulkArchive(ctxA, [leadBId]);
    expect(count).toBe(0);

    const [row] = await db.select().from(businesses).where(eq(businesses.id, leadBId));
    expect(row?.archivedAt).toBeNull();
  });

  it("allows mutations inside the active workspace", async () => {
    await updateLead(ctxA, leadAId, { status: "qualified", notes: "called on Tuesday" });

    const detail = await getLeadDetail(ctxA, leadAId);
    expect(detail.lead.status).toBe("qualified");
    expect(detail.lead.notes).toBe("called on Tuesday");

    const [rowB] = await db.select().from(businesses).where(eq(businesses.id, leadBId));
    expect(rowB?.status).toBe("new");
  });

  it("matches duplicates by host and filters leads by scan outcome", async () => {
    await db
      .update(businesses)
      .set({ websiteHost: "alpha-dental.example", street: "12 Test Road", latestScanOutcome: "success" })
      .where(eq(businesses.id, leadAId));

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
    await db.insert(businesses).values({
      id: duplicateId,
      workspaceId: workspaceAId,
      name: "Alpha Dental Studio (dup)",
      normalizedName: "alpha dental studio dup",
      city: "Dubai",
      categoryKey: "dentist",
    });
    await db.insert(tags).values({ id: tagId, workspaceId: workspaceAId, name: `priority-${runId}` });
    await db
      .insert(businessTags)
      .values({ workspaceId: workspaceAId, businessId: duplicateId, tagId });
    await db.insert(notes).values({
      id: noteId,
      workspaceId: workspaceAId,
      businessId: duplicateId,
      body: "Merged note",
      authorId: userAId,
    });

    const [pair] = await db
      .insert(duplicateCandidates)
      .values({
        workspaceId: workspaceAId,
        businessAId: leadAId,
        businessBId: duplicateId,
        similarity: 1,
        reasons: ["test pair"],
      })
      .returning();

    await resolveDuplicate(ctxA, pair.id, "merge", "a");

    const [merged] = await db.select().from(businesses).where(eq(businesses.id, duplicateId));
    expect(merged.mergedIntoId).toBe(leadAId);
    const [movedNote] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(movedNote.businessId).toBe(leadAId);

    await undoLastMerge(ctxA);

    const [restored] = await db.select().from(businesses).where(eq(businesses.id, duplicateId));
    expect(restored.mergedIntoId).toBeNull();
    const [restoredNote] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(restoredNote.businessId).toBe(duplicateId);
    const tagLinks = await db
      .select()
      .from(businessTags)
      .where(and(eq(businessTags.workspaceId, workspaceAId), eq(businessTags.tagId, tagId)));
    expect(tagLinks).toHaveLength(1);
    expect(tagLinks[0]?.businessId).toBe(duplicateId);
  });
});
