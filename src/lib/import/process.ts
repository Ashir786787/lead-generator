import path from "node:path";
import { collections, now } from "@/lib/db";
import {
  storageRoot,
  materializeUpload,
  deleteStored,
  removeTempDirectory,
} from "@/lib/storage";
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
  const job = await collections.importJobs.findOne({
    workspaceId,
    _id: importJobId,
  });
  if (!job) return { status: "failed", error: "Import job not found." };
  if (job.status === "completed" || job.status === "cancelled") return { status: "skipped" };
  if (!job.storagePath) {
    await failImport(workspaceId, importJobId, "The uploaded file is missing from storage.");
    return { status: "failed", error: "The uploaded file is missing from storage." };
  }

  const workspace = await collections.workspaces.findOne(
    { _id: workspaceId },
    { projection: { _id: 1, isDemo: 1 } },
  );
  if (!workspace) {
    await failImport(workspaceId, importJobId, "The workspace no longer exists.");
    return { status: "failed", error: "The workspace no longer exists." };
  }

  const workDir = path.join(storageRoot, "tmp", `import-${importJobId}`);
  await collections.importJobs.updateOne(
    { workspaceId, _id: importJobId },
    { $set: { status: "processing", startedAt: now(), progress: 1, error: null } },
  );

  try {
    await removeTempDirectory(workDir);
    // GridFS is the durable copy; the parsers need a real file to stream.
    const filePath = await materializeUpload(job.storagePath, workDir, job.filename);
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
        const moment = Date.now();
        if (moment - lastWrite < 400 && processed !== totalHint) return;
        lastWrite = moment;
        const progress = totalHint
          ? Math.min(99, Math.max(2, Math.floor((processed / totalHint) * 100)))
          : Math.min(95, 2 + Math.floor(processed / 25));
        await collections.importJobs.updateOne(
          { workspaceId, _id: importJobId },
          {
            $set: {
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
            },
          },
        );
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

    // The file is only needed while the import runs. Dropping the GridFS copy
    // keeps the shared Atlas quota free; the job row keeps the hash for
    // duplicate-upload detection.
    await deleteStored(job.storagePath);
    await collections.importJobs.updateOne(
      { workspaceId, _id: importJobId },
      { $set: { storagePath: null } },
    );

    return { status: "completed", counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The import could not be completed.";
    logger.error({ err: error, importJobId }, "Import processing failed");
    await failImport(workspaceId, importJobId, message);
    return { status: "failed", error: message };
  } finally {
    await removeTempDirectory(workDir);
  }
}

async function failImport(workspaceId: string, importJobId: string, message: string): Promise<void> {
  await collections.importJobs.updateOne(
    { workspaceId, _id: importJobId },
    {
      $set: {
        status: "failed",
        error: message.slice(0, 2000),
        finishedAt: now(),
        progress: 100,
      },
    },
  );
  await publishEvent(workspaceId, "import.failed", { importJobId, message });
}
