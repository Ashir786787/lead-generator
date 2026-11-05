import { and, count, countDistinct, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, scanJobs, scanResults } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { conflict, notFound } from "@/lib/api/errors";
import { publishEvent } from "@/lib/events/bus";
import { sendJob, JOB_NAMES } from "@/lib/jobs/boss";
import { getWorkerHealth, isScanWorkerOnline } from "@/lib/jobs/health";
import { env } from "@/lib/env";

export interface QueuedScan {
  businessId: string;
  scanJobId: string | null;
  reason?: "no_website" | "already_running" | "not_found";
}

export async function queueScans(
  ctx: WorkspaceContext,
  businessIds: string[],
  force: boolean,
): Promise<QueuedScan[]> {
  const ids = [...new Set(businessIds)].slice(0, 100);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: businesses.id,
      websiteUrl: businesses.websiteUrl,
      mergedIntoId: businesses.mergedIntoId,
    })
    .from(businesses)
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), inArray(businesses.id, ids)));

  const found = new Map(rows.map((row) => [row.id, row]));
  const active = await db
    .select({ businessId: scanJobs.businessId })
    .from(scanJobs)
    .where(
      and(
        eq(scanJobs.workspaceId, ctx.workspaceId),
        inArray(scanJobs.businessId, ids),
        inArray(scanJobs.status, ["queued", "processing"]),
      ),
    );
  const activeSet = new Set(active.map((row) => row.businessId));

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
    const [job] = await db
      .insert(scanJobs)
      .values({
        workspaceId: ctx.workspaceId,
        businessId: id,
        requestedBy: ctx.user.id,
        force,
        status: "queued",
      })
      .returning({ id: scanJobs.id });
    if (!job) {
      results.push({ businessId: id, scanJobId: null, reason: "not_found" });
      continue;
    }
    await sendJob(
      JOB_NAMES.scanBusiness,
      { workspaceId: ctx.workspaceId, businessId: id, scanJobId: job.id, force },
      { singletonKey: `scan:${job.id}`, retryLimit: 1, expireInSeconds: 10 * 60 },
    );
    await publishEvent(ctx.workspaceId, "scan.queued", { businessId: id, scanJobId: job.id });
    results.push({ businessId: id, scanJobId: job.id });
  }
  return results;
}

export async function cancelScan(ctx: WorkspaceContext, scanJobId: string): Promise<void> {
  const [job] = await db
    .select({ id: scanJobs.id, status: scanJobs.status })
    .from(scanJobs)
    .where(and(eq(scanJobs.workspaceId, ctx.workspaceId), eq(scanJobs.id, scanJobId)))
    .limit(1);
  if (!job) throw notFound("Scan not found.");
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    throw conflict("This scan has already finished.");
  }
  await db
    .update(scanJobs)
    .set({
      cancelRequested: true,
      ...(job.status === "queued" ? { status: "cancelled", finishedAt: new Date() } : {}),
    })
    .where(and(eq(scanJobs.workspaceId, ctx.workspaceId), eq(scanJobs.id, scanJobId)));
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
  const rows = await db
    .select({
      id: scanJobs.id,
      businessId: scanJobs.businessId,
      businessName: businesses.name,
      status: scanJobs.status,
      outcome: scanJobs.outcome,
      progress: scanJobs.progress,
      pagesTotal: scanJobs.pagesTotal,
      pagesDone: scanJobs.pagesDone,
      createdAt: scanJobs.createdAt,
      finishedAt: scanJobs.finishedAt,
      error: scanJobs.error,
    })
    .from(scanJobs)
    .innerJoin(businesses, eq(businesses.id, scanJobs.businessId))
    .where(
      businessId
        ? and(eq(scanJobs.workspaceId, ctx.workspaceId), eq(scanJobs.businessId, businessId))
        : eq(scanJobs.workspaceId, ctx.workspaceId),
    )
    .orderBy(desc(scanJobs.createdAt))
    .limit(50);
  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    businessName: row.businessName,
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
  const [jobs, neverChecked, needsReview, worker] = await Promise.all([
    db
      .select({
        queued: sql<number>`count(*) filter (where ${scanJobs.status} = 'queued')`,
        running: sql<number>`count(*) filter (where ${scanJobs.status} = 'processing')`,
      })
      .from(scanJobs)
      .where(
        and(
          eq(scanJobs.workspaceId, ctx.workspaceId),
          inArray(scanJobs.status, ["queued", "processing"]),
        ),
      ),
    db
      .select({ value: count() })
      .from(businesses)
      .where(
        and(
          eq(businesses.workspaceId, ctx.workspaceId),
          isNull(businesses.mergedIntoId),
          isNull(businesses.lastCheckedAt),
          isNotNull(businesses.websiteUrl),
        ),
      ),
    db
      .select({ value: countDistinct(scanResults.businessId) })
      .from(scanResults)
      .where(
        and(
          eq(scanResults.workspaceId, ctx.workspaceId),
          inArray(scanResults.outcome, [
            "partial",
            "blocked_by_robots",
            "unreachable",
            "timeout",
            "tls_error",
            "non_html",
            "rejected_url",
            "error",
          ]),
        ),
      ),
    getWorkerHealth(),
  ]);
  return {
    queued: Number(jobs[0]?.queued ?? 0),
    running: Number(jobs[0]?.running ?? 0),
    needsReview: Number(needsReview[0]?.value ?? 0),
    neverChecked: Number(neverChecked[0]?.value ?? 0),
    workerOnline: isScanWorkerOnline(worker),
  };
}

export function scanCacheCutoff(): Date {
  return new Date(Date.now() - env.scan.cacheDays * 24 * 60 * 60 * 1000);
}
