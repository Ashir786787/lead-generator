import fs from "node:fs/promises";
import { and, desc, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { importJobs, importRowErrors, workspaces } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound, conflict } from "@/lib/api/errors";
import { hashBuffer, hashText, resolveStoredPath, saveUpload } from "@/lib/storage";
import { env } from "@/lib/env";
import { previewFile, supportedExtension, countRowsHint, type FilePreview } from "./parse";
import { guessMapping, mappingWarnings, IMPORT_FIELDS, type ColumnMapping, type ImportField } from "./mapping";
import { sendJob, JOB_NAMES } from "@/lib/jobs/boss";
import { logger } from "@/lib/logger";

export interface ImportPreviewResult {
  importJobId: string;
  filename: string;
  fileHash: string;
  preview: FilePreview;
  mapping: ColumnMapping;
  warnings: string[];
  rowHint: number | null;
  duplicateOf: { id: string; filename: string; createdAt: string } | null;
}

/**
 * Every import column except the (potentially large) base64 file payload.
 * Listing imports must never load stored files into memory.
 */
const importSummaryColumns = {
  ...getTableColumns(importJobs),
  fileData: sql<string | null>`null`.as("file_data"),
};

function sanitiseMapping(input: unknown): ColumnMapping {
  if (!input || typeof input !== "object") return {};
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) mapping[field as ImportField] = value.trim();
  }
  return mapping;
}

export async function createImportPreview(
  ctx: WorkspaceContext,
  file: File,
): Promise<ImportPreviewResult> {
  if (!file.name || file.size === 0) throw conflict("Choose a non-empty file to upload.");
  if (!supportedExtension(file.name)) {
    throw conflict("Unsupported file type. Upload a .csv, .tsv, .geojson, .json or .zip file.");
  }
  if (file.size > env.maxUploadBytes) {
    throw conflict(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw conflict("The uploaded file is empty.");
  const hash = hashBuffer(buffer);
  const stored = await saveUpload(ctx.workspaceId, file.name, buffer);
  const storeInDatabase = env.uploadStorage === "database";

  let preview: FilePreview;
  let rowHint: number | null;
  try {
    preview = await previewFile(stored.absolutePath, file.name);
    rowHint = await countRowsHint(stored.absolutePath);
  } catch (error) {
    await fs.rm(stored.absolutePath, { force: true }).catch(() => undefined);
    throw conflict(error instanceof Error ? error.message : "Could not read this file.");
  }

  const mapping = guessMapping(preview.columns);
  if (storeInDatabase) {
    // The preview is finished; the durable copy below lives in PostgreSQL.
    await fs.rm(stored.absolutePath, { force: true }).catch(() => undefined);
  }
  const [duplicateOf] = await db
    .select({ id: importJobs.id, filename: importJobs.filename, createdAt: importJobs.createdAt })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.workspaceId, ctx.workspaceId),
        eq(importJobs.fileHash, hash),
        isNotNull(importJobs.finishedAt),
        eq(importJobs.status, "completed"),
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(1);

  const [job] = await db
    .insert(importJobs)
    .values({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.user.id,
      origin: "import",
      filename: file.name.slice(0, 240),
      fileHash: hash,
      storagePath: storeInDatabase ? null : stored.storedPath,
      fileData: storeInDatabase ? buffer.toString("base64") : null,
      mapping,
      detectedColumns: preview.columns,
      status: "queued",
      rowCount: rowHint ?? 0,
      mappingConfirmed: false,
    })
    .returning({ id: importJobs.id });
  if (!job) throw new Error("Could not create the import job.");

  return {
    importJobId: job.id,
    filename: file.name,
    fileHash: hash,
    preview,
    mapping,
    warnings: mappingWarnings(mapping),
    rowHint,
    duplicateOf: duplicateOf
      ? { id: duplicateOf.id, filename: duplicateOf.filename, createdAt: duplicateOf.createdAt.toISOString() }
      : null,
  };
}

export async function startImport(
  ctx: WorkspaceContext,
  importJobId: string,
  mappingInput: unknown,
  options: { force?: boolean } = {},
): Promise<{
  importJobId: string;
  queued: boolean;
  completed?: boolean;
  status?: string;
  existingJobId?: string;
}> {
  const [job] = await db
    .select({
      status: importJobs.status,
      startedAt: importJobs.startedAt,
      mapping: importJobs.mapping,
      mappingConfirmed: importJobs.mappingConfirmed,
      fileHash: importJobs.fileHash,
    })
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) throw notFound("Import not found.");
  if (job.status === "completed") throw conflict("This import has already finished.");
  // Inline requests can be cut off by the platform, leaving a job in
  // "processing". There is no worker to resume it, so allow an explicit retry
  // once the previous request is clearly gone.
  if (
    !env.inlineJobs &&
    (job.status === "processing" || (job.status === "queued" && job.mappingConfirmed))
  ) {
    throw conflict("This import is already queued or running.");
  }
  if (
    env.inlineJobs &&
    job.status === "processing" &&
    job.startedAt &&
    Date.now() - job.startedAt.getTime() < 5 * 60 * 1000
  ) {
    throw conflict("This import is already running.");
  }

  const mapping = sanitiseMapping(mappingInput ?? job.mapping);
  if (!mapping.name) throw conflict("Map a column to “Business name” before starting the import.");
  const mappingHash = hashText(
    JSON.stringify(Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))),
  );

  if (job.fileHash && !options.force) {
    const [existing] = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.workspaceId, ctx.workspaceId),
          eq(importJobs.fileHash, job.fileHash),
          eq(importJobs.mappingHash, mappingHash),
          eq(importJobs.status, "completed"),
        ),
      )
      .limit(1);
    if (existing && existing.id !== importJobId) {
      return { importJobId, queued: false, existingJobId: existing.id };
    }
  }

  await db
    .update(importJobs)
    .set({
      mapping,
      mappingHash,
      mappingConfirmed: true,
      status: "queued",
      progress: 0,
      error: null,
    })
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)));

  if (env.inlineJobs) {
    // Serverless mode: run the import inside this request instead of waiting
    // for a worker that cannot exist on the platform.
    const { processImport } = await import("./process");
    const processed = await processImport(ctx.workspaceId, importJobId);
    return {
      importJobId,
      queued: false,
      completed: processed.status === "completed",
      status: processed.status,
    };
  }

  await sendJob(
    JOB_NAMES.importProcess,
    { workspaceId: ctx.workspaceId, importJobId },
    { singletonKey: `import:${importJobId}`, retryLimit: 1, expireInSeconds: 60 * 60 },
  );

  return { importJobId, queued: true };
}

export interface ImportSummary {
  id: string;
  filename: string;
  origin: string;
  status: string;
  progress: number;
  processedRows: number;
  rowCount: number;
  validCount: number;
  newCount: number;
  duplicateCount: number;
  mergedCount: number;
  reviewCount: number;
  skippedCount: number;
  errorCount: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  duplicateFile: boolean;
}

function toSummary(row: typeof importJobs.$inferSelect, duplicateFile: boolean): ImportSummary {
  return {
    id: row.id,
    filename: row.filename,
    origin: row.origin,
    status: row.status,
    progress: row.progress,
    processedRows: row.processedRows,
    rowCount: row.rowCount,
    validCount: row.validCount,
    newCount: row.newCount,
    duplicateCount: row.duplicateCount,
    mergedCount: row.mergedCount,
    reviewCount: row.reviewCount,
    skippedCount: row.skippedCount,
    errorCount: row.errorCount,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    duplicateFile: duplicateFile,
  };
}

export async function listImports(ctx: WorkspaceContext): Promise<ImportSummary[]> {
  const rows = await db
    .select(importSummaryColumns)
    .from(importJobs)
    .where(eq(importJobs.workspaceId, ctx.workspaceId))
    .orderBy(desc(importJobs.createdAt))
    .limit(50);

  const duplicateHashes = new Set<string>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.fileHash) continue;
    const key = `${row.fileHash}:${row.mappingHash ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) > 1) duplicateHashes.add(row.fileHash);
  }

  return rows.map((row) => toSummary(row, row.fileHash ? duplicateHashes.has(row.fileHash) : false));
}

export interface ImportDetail extends ImportSummary {
  mapping: ColumnMapping;
  detectedColumns: string[] | null;
  errors: Array<{ id: string; rowNumber: number; reason: string; raw: Record<string, unknown> | null }>;
}

export async function getImport(ctx: WorkspaceContext, importJobId: string): Promise<ImportDetail> {
  const [job] = await db
    .select(importSummaryColumns)
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) throw notFound("Import not found.");
  const errors = await db
    .select()
    .from(importRowErrors)
    .where(
      and(eq(importRowErrors.workspaceId, ctx.workspaceId), eq(importRowErrors.importJobId, importJobId)),
    )
    .orderBy(importRowErrors.rowNumber)
    .limit(200);
  return {
    ...toSummary(job, false),
    mapping: job.mapping ?? {},
    detectedColumns: job.detectedColumns ?? null,
    errors: errors.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      reason: row.reason,
      raw: row.raw ?? null,
    })),
  };
}

export async function cancelImport(ctx: WorkspaceContext, importJobId: string): Promise<void> {
  const [job] = await db
    .select({ id: importJobs.id, status: importJobs.status })
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) throw notFound("Import not found.");
  if (job.status === "completed") throw conflict("A finished import cannot be cancelled.");
  await db
    .update(importJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)));
}

export async function deleteImport(ctx: WorkspaceContext, importJobId: string): Promise<void> {
  const [job] = await db
    .select({ status: importJobs.status, storagePath: importJobs.storagePath })
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) throw notFound("Import not found.");
  if (job.status === "processing" || job.status === "queued") {
    throw conflict("Wait for this import to finish before deleting it.");
  }
  await db
    .delete(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)));
  if (job.storagePath) {
    await fs.rm(resolveStoredPath(job.storagePath), { force: true }).catch(() => undefined);
  }
}

export async function loadWorkerActor(workspaceId: string): Promise<{
  workspaceId: string;
  userId: string | null;
  isDemo: boolean;
}> {
  const [workspace] = await db
    .select({ id: workspaces.id, isDemo: workspaces.isDemo })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Error(`Workspace ${workspaceId} no longer exists.`);
  const [job] = await db
    .select({ createdBy: importJobs.createdBy })
    .from(importJobs)
    .where(eq(importJobs.workspaceId, workspaceId))
    .orderBy(desc(importJobs.createdAt))
    .limit(1);
  return { workspaceId: workspace.id, userId: job?.createdBy ?? null, isDemo: workspace.isDemo };
}

export interface ImportErrorCsvRow {
  rowNumber: number;
  reason: string;
  raw: Record<string, unknown> | null;
}

export async function importErrorRows(
  ctx: WorkspaceContext,
  importJobId: string,
): Promise<ImportErrorCsvRow[]> {
  const [job] = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, importJobId)))
    .limit(1);
  if (!job) throw notFound("Import not found.");
  const rows = await db
    .select({ rowNumber: importRowErrors.rowNumber, reason: importRowErrors.reason, raw: importRowErrors.raw })
    .from(importRowErrors)
    .where(
      and(eq(importRowErrors.workspaceId, ctx.workspaceId), eq(importRowErrors.importJobId, importJobId)),
    )
    .orderBy(importRowErrors.rowNumber);
  return rows;
}

export async function countImportErrors(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(importRowErrors)
    .where(eq(importRowErrors.workspaceId, ctx.workspaceId));
  return Number(row?.value ?? 0);
}

/** Logged for diagnostics without leaking file contents. */
export function logImportFailure(importJobId: string, error: unknown): void {
  logger.error({ err: error, importJobId }, "Import failed");
}
