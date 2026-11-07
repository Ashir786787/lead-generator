import { collections, newId, now } from "@/lib/db";
import type { ScanJobDoc, ScanOutcome } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { conflict, notFound } from "@/lib/api/errors";
import { publishEvent } from "@/lib/events/bus";
import { env } from "@/lib/env";

export interface QueuedScan {
  businessId: string;
  scanJobId: string | null;
  reason?: "no_website" | "already_running" | "not_found";
  /** Present when the scan ran inline. */
  outcome?: string;
}

const BAD_OUTCOMES: ScanOutcome[] = [
  "partial",
  "blocked_by_robots",
  "unreachable",
  "timeout",
  "tls_error",
  "non_html",
  "rejected_url",
  "error",
];

export async function queueScans(
  ctx: WorkspaceContext,
  businessIds: string[],
  force: boolean,
): Promise<QueuedScan[]> {
  const ids = [...new Set(businessIds)].slice(0, 100);
  if (!ids.length) return [];
  const rows = await collections.businesses
    .find(
      { workspaceId: ctx.workspaceId, _id: { $in: ids } },
      { projection: { _id: 1, websiteUrl: 1, mergedIntoId: 1 } },
    )
    .toArray();

  const found = new Map(rows.map((row) => [row._id, row]));

  // A request killed by the platform can leave a scan "processing" forever.
  // Clear stale rows so the lead can be scanned again.
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000);
  await collections.scanJobs.updateMany(
    {
      workspaceId: ctx.workspaceId,
      businessId: { $in: ids },
      status: { $in: ["queued", "processing"] },
      createdAt: { $lt: staleCutoff },
    },
    {
      $set: {
        status: "failed",
        error: "An earlier inline scan did not finish before the request ended. Retry the scan.",
        finishedAt: now(),
        progress: 100,
      },
    },
  );

  const active = await collections.scanJobs
    .find(
      {
        workspaceId: ctx.workspaceId,
        businessId: { $in: ids },
        status: { $in: ["queued", "processing"] },
      },
      { projection: { _id: 0, businessId: 1 } },
    )
    .toArray();
  const activeSet = new Set(active.map((row) => row.businessId));

  // Serverless requests have a hard duration cap, so inline work gets a budget
  // and any remaining scans are marked failed with an honest explanation.
  const inlineDeadline = Date.now() + env.inlineJobBudgetMs;

  const results: QueuedScan[] = [];
  for (const id of ids) {
    const business = found.get(id);
    if (!business || business.mergedIntoId) {
      results.push({ businessId: id, scanJobId: null, reason: "not_found" });
      continue;
    }
    if (!business.websiteUrl) {
      results.push({ businessId: id, scanJobId: null, reason: "no_website" });
      continue;
    }
    if (activeSet.has(id)) {
      results.push({ businessId: id, scanJobId: null, reason: "already_running" });
      continue;
    }

    const timestamp = now();
    const job: ScanJobDoc = {
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId: id,
      requestedBy: ctx.user.id,
      status: "queued",
      outcome: null,
      progress: 0,
      pagesTotal: 0,
      pagesDone: 0,
      force,
      cancelRequested: false,
      error: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
    };
    await collections.scanJobs.insertOne(job);
    await publishEvent(ctx.workspaceId, "scan.queued", { businessId: id, scanJobId: job._id });

    if (Date.now() >= inlineDeadline) {
      const message =
        "The serverless request time limit was reached before this scan could run. Retry it in a smaller batch.";
      await collections.scanJobs.updateOne(
        { workspaceId: ctx.workspaceId, _id: job._id },
        { $set: { status: "failed", error: message, finishedAt: now(), progress: 100 } },
      );
      await publishEvent(ctx.workspaceId, "scan.failed", { scanJobId: job._id, message });
      results.push({ businessId: id, scanJobId: job._id, outcome: "error" });
      continue;
    }
    const { processScan } = await import("./process");
    const outcome = await processScan(ctx.workspaceId, id, job._id, force);
    results.push({ businessId: id, scanJobId: job._id, outcome: outcome.outcome });
  }
  return results;
}

export async function cancelScan(ctx: WorkspaceContext, scanJobId: string): Promise<void> {
  const job = await collections.scanJobs.findOne(
    { workspaceId: ctx.workspaceId, _id: scanJobId },
    { projection: { _id: 1, status: 1 } },
  );
  if (!job) throw notFound("Scan not found.");
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    throw conflict("This scan has already finished.");
  }
  await collections.scanJobs.updateOne(
    { workspaceId: ctx.workspaceId, _id: scanJobId },
    {
      $set: {
        cancelRequested: true,
        ...(job.status === "queued" ? { status: "cancelled", finishedAt: now() } : {}),
      },
    },
  );
  await publishEvent(ctx.workspaceId, "job.cancelled", { scanJobId });
}

export interface ScanJobSummary {
  id: string;
  businessId: string;
  businessName: string | null;
  status: string;
  outcome: string | null;
  progress: number;
  pagesTotal: number;
  pagesDone: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
}

export async function listScanJobs(
  ctx: WorkspaceContext,
  businessId?: string,
): Promise<ScanJobSummary[]> {
  const filter = businessId
    ? { workspaceId: ctx.workspaceId, businessId }
    : { workspaceId: ctx.workspaceId };
  const rows = await collections.scanJobs
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  const businessIds = [...new Set(rows.map((row) => row.businessId))];
  const businesses = businessIds.length
    ? await collections.businesses
        .find(
          { _id: { $in: businessIds } },
          { projection: { _id: 1, name: 1 } },
        )
        .toArray()
    : [];
  const nameById = new Map(businesses.map((business) => [business._id, business.name]));
  return rows.map((row) => ({
    id: row._id,
    businessId: row.businessId,
    businessName: nameById.get(row.businessId) ?? null,
    status: row.status,
    outcome: row.outcome,
    progress: row.progress,
    pagesTotal: row.pagesTotal,
    pagesDone: row.pagesDone,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
  }));
}

export async function scanQueueSummary(ctx: WorkspaceContext): Promise<{
  queued: number;
  running: number;
  needsReview: number;
  neverChecked: number;
  workerOnline: boolean;
}> {
  const [queued, running, neverChecked, badBusinessIds] = await Promise.all([
    collections.scanJobs.countDocuments({
      workspaceId: ctx.workspaceId,
      status: "queued",
    }),
    collections.scanJobs.countDocuments({
      workspaceId: ctx.workspaceId,
      status: "processing",
    }),
    collections.businesses.countDocuments({
      workspaceId: ctx.workspaceId,
      mergedIntoId: null,
      lastCheckedAt: null,
      websiteUrl: { $ne: null },
    }),
    collections.scanResults.distinct("businessId", {
      workspaceId: ctx.workspaceId,
      outcome: { $in: BAD_OUTCOMES },
    }),
  ]);
  return {
    queued,
    running,
    needsReview: badBusinessIds.length,
    neverChecked,
    // Jobs always run inline in the request, so scanning is always available.
    workerOnline: true,
  };
}

export function scanCacheCutoff(): Date {
  return new Date(Date.now() - env.scan.cacheDays * 24 * 60 * 60 * 1000);
}
