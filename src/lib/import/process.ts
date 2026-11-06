import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { importJobs, workspaces } from "@/lib/db/schema";
import { storageRoot, materializeUpload, resolveStoredPath } from "@/lib/storage";
import { iterateFile, countRowsHint } from "./parse";
import { finalizeImportJob, ingestRecords, type IngestCounts } from "./ingest";
import { publishEvent } from "@/lib/events/bus";
import type { ColumnMapping } from "./mapping";
import { logger } from "@/lib/logger";

export interface ImportProcessResult {
  status: "completed" | "failed" | "skipped";
  counts?: IngestCounts;
  error?: string;
}

export async function processImport(workspaceId: string, importJobId: string): Promise<ImportProcessResult> {
  const [job] = await db
    .select({
      status: importJobs.status,
      storagePath: importJobs.storagePath,
      fileData: importJobs.fileData,
      rowCount: importJobs.rowCount,
      createdBy: importJobs.createdBy,
      filename: importJobs.filename,
      mapping: importJobs.mapping,
    })
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) return { status: "failed", error: "Import job not found." };
  if (job.status === "completed" || job.status === "cancelled") return { status: "skipped" };
  if (!job.storagePath && !job.fileData) {
    await failImport(workspaceId, importJobId, "The uploaded file is missing from storage.");
    return { status: "failed", error: "The uploaded file is missing from storage." };
  }

  const [workspace] = await db
    .select({ isDemo: workspaces.isDemo })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    await failImport(workspaceId, importJobId, "The workspace no longer exists.");
    return { status: "failed", error: "The workspace no longer exists." };
  }

  const workDir = path.join(storageRoot, "tmp", `import-${importJobId}`);
  await db
    .update(importJobs)
    .set({ status: "processing", startedAt: new Date(), progress: 1, error: null })
    .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, importJobId)));

  try {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(workDir, { recursive: true });
    // Local mode reads the persisted upload; serverless mode writes the
    // database copy into the only writable directory (/tmp) for streaming.
    const filePath = job.storagePath
      ? resolveStoredPath(job.storagePath)
      : await materializeUpload(workDir, job.filename, job.fileData ?? "");
    const totalHint = job.rowCount > 0 ? job.rowCount : (await countRowsHint(filePath)) ?? undefined;

    const actor = { workspaceId, userId: job.createdBy, isDemo: workspace.isDemo };
    const mapping = (job.mapping ?? {}) as ColumnMapping;
    let lastWrite = 0;

    const counts = await ingestRecords({
      actor,
      jobId: importJobId,
      source: "import",
      sourceLabel: `Import: ${job.filename}`,
      mapping,
      fallbackPrefix: "import",
      totalHint,
      records: iterateFile(filePath, job.filename, workDir),
      onProgress: async (current, processed) => {
        const now = Date.now();
        if (now - lastWrite < 400 && processed !== totalHint) return;
        lastWrite = now;
        const progress = totalHint
          ? Math.min(99, Math.max(2, Math.floor((processed / totalHint) * 100)))
          : Math.min(95, 2 + Math.floor(processed / 25));
        await db
          .update(importJobs)
          .set({
            processedRows: processed,
            progress,
            rowCount: totalHint ?? processed,
            newCount: current.newCount,
            mergedCount: current.mergedCount,
            duplicateCount: current.duplicateCount,
            skippedCount: current.skippedCount,
            errorCount: current.errorCount,
            reviewCount: current.reviewCount,
            validCount: current.validCount,
          })
          .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, importJobId)));
        await publishEvent(workspaceId, "import.progress", {
          importJobId,
          processed,
          total: totalHint ?? null,
          progress,
          counts: current,
        });
      },
    });

    if (counts.rowCount === 0 && counts.errorCount === 0) {
      throw new Error(
        "No data rows were found. Check that the file has a header row and at least one business row.",
      );
    }

    await finalizeImportJob(actor, importJobId, counts);
    if (job.fileData) {
      // The import is complete; drop the base64 copy to keep the database small.
      await db
        .update(importJobs)
        .set({ fileData: null })
        .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, importJobId)));
    }
    return { status: "completed", counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The import could not be completed.";
    logger.error({ err: error, importJobId }, "Import processing failed");
    await failImport(workspaceId, importJobId, message);
    return { status: "failed", error: message };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function failImport(workspaceId: string, importJobId: string, message: string): Promise<void> {
  await db
    .update(importJobs)
    .set({
      status: "failed",
      error: message.slice(0, 2000),
      finishedAt: new Date(),
      progress: 100,
    })
    .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, importJobId)));
  await publishEvent(workspaceId, "import.failed", { importJobId, message });
}
