import { collections, newId, now } from "@/lib/db";
import type { ImportJobDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound, conflict } from "@/lib/api/errors";
import {
  hashBuffer,
  hashText,
  saveUpload,
  writeTempFile,
  removeTempDirectory,
  deleteStored,
} from "@/lib/storage";
import { env } from "@/lib/env";
import { previewFile, supportedExtension, countRowsHint, type FilePreview } from "./parse";
import { guessMapping, mappingWarnings, IMPORT_FIELDS, type ColumnMapping, type ImportField } from "./mapping";

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

  // The preview needs a real file for the streaming CSV / ZIP parsers, so the
  // buffer is written to the temp directory and removed immediately after.
  const previewDir = `preview-${newId()}`;
  let preview: FilePreview;
  let rowHint: number | null;
  try {
    const tempPath = await writeTempFile(previewDir, file.name, buffer);
    preview = await previewFile(tempPath, file.name);
    rowHint = await countRowsHint(tempPath);
  } catch (error) {
    await deleteStored(stored.storedPath);
    throw conflict(error instanceof Error ? error.message : "Could not read this file.");
  } finally {
    await removeTempDirectory(previewDir);
  }

  const mapping = guessMapping(preview.columns);

  const duplicateOf = await collections.importJobs.findOne(
    {
      workspaceId: ctx.workspaceId,
      fileHash: hash,
      status: "completed",
      finishedAt: { $ne: null },
    },
    { sort: { createdAt: -1 }, projection: { _id: 1, filename: 1, createdAt: 1 } },
  );

  const timestamp = now();
  const job: ImportJobDoc = {
    _id: newId(),
    workspaceId: ctx.workspaceId,
    createdBy: ctx.user.id,
    origin: "import",
    filename: file.name.slice(0, 240),
    fileHash: hash,
    mappingHash: null,
    idempotencyKey: null,
    storagePath: stored.storedPath,
    mapping,
    detectedColumns: preview.columns,
    status: "queued",
    progress: 0,
    processedRows: 0,
    rowCount: rowHint ?? 0,
    validCount: 0,
    newCount: 0,
    duplicateCount: 0,
    mergedCount: 0,
    reviewCount: 0,
    skippedCount: 0,
    errorCount: 0,
    mappingConfirmed: false,
    error: null,
    createdAt: timestamp,
    startedAt: null,
    finishedAt: null,
  };
  await collections.importJobs.insertOne(job);

  return {
    importJobId: job._id,
    filename: file.name,
    fileHash: hash,
    preview,
    mapping,
    warnings: mappingWarnings(mapping),
    rowHint,
    duplicateOf: duplicateOf
      ? { id: duplicateOf._id, filename: duplicateOf.filename, createdAt: duplicateOf.createdAt.toISOString() }
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
  const job = await collections.importJobs.findOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    {
      projection: {
        status: 1,
        startedAt: 1,
        mapping: 1,
        mappingConfirmed: 1,
        fileHash: 1,
      },
    },
  );
  if (!job) throw notFound("Import not found.");
  if (job.status === "completed") throw conflict("This import has already finished.");
  // Requests can be cut off by the platform, leaving a job in "processing".
  // There is no separate worker, so an explicit retry is allowed once the
  // previous request is clearly gone.
  if (
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
    const existing = await collections.importJobs.findOne(
      {
        workspaceId: ctx.workspaceId,
        fileHash: job.fileHash,
        mappingHash,
        status: "completed",
      },
      { projection: { _id: 1 } },
    );
    if (existing && existing._id !== importJobId) {
      return { importJobId, queued: false, existingJobId: existing._id };
    }
  }

  await collections.importJobs.updateOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    {
      $set: {
        mapping,
        mappingHash,
        mappingConfirmed: true,
        status: "queued",
        progress: 0,
        error: null,
      },
    },
  );

  // Imports always run inside this request: serverless deployments have no
  // long-lived worker process to pick up a queue.
  const { processImport } = await import("./process");
  const processed = await processImport(ctx.workspaceId, importJobId);
  return {
    importJobId,
    queued: false,
    completed: processed.status === "completed",
    status: processed.status,
  };
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

function toSummary(row: ImportJobDoc, duplicateFile: boolean): ImportSummary {
  return {
    id: row._id,
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
    duplicateFile,
  };
}

export async function listImports(ctx: WorkspaceContext): Promise<ImportSummary[]> {
  const rows = await collections.importJobs
    .find({ workspaceId: ctx.workspaceId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

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
  const job = await collections.importJobs.findOne({
    workspaceId: ctx.workspaceId,
    _id: importJobId,
  });
  if (!job) throw notFound("Import not found.");
  const errors = await collections.importRowErrors
    .find({ workspaceId: ctx.workspaceId, importJobId })
    .sort({ rowNumber: 1 })
    .limit(200)
    .toArray();
  return {
    ...toSummary(job, false),
    mapping: job.mapping ?? {},
    detectedColumns: job.detectedColumns ?? null,
    errors: errors.map((row) => ({
      id: row._id,
      rowNumber: row.rowNumber,
      reason: row.reason,
      raw: row.raw ?? null,
    })),
  };
}

export async function cancelImport(ctx: WorkspaceContext, importJobId: string): Promise<void> {
  const job = await collections.importJobs.findOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    { projection: { _id: 1, status: 1 } },
  );
  if (!job) throw notFound("Import not found.");
  if (job.status === "completed") throw conflict("A finished import cannot be cancelled.");
  await collections.importJobs.updateOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    { $set: { status: "cancelled", finishedAt: now() } },
  );
}

export async function deleteImport(ctx: WorkspaceContext, importJobId: string): Promise<void> {
  const job = await collections.importJobs.findOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    { projection: { status: 1, storagePath: 1 } },
  );
  if (!job) throw notFound("Import not found.");
  if (job.status === "processing" || job.status === "queued") {
    throw conflict("Wait for this import to finish before deleting it.");
  }
  await collections.importJobs.deleteOne({ workspaceId: ctx.workspaceId, _id: importJobId });
  if (job.storagePath) await deleteStored(job.storagePath);
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
  const job = await collections.importJobs.findOne(
    { workspaceId: ctx.workspaceId, _id: importJobId },
    { projection: { _id: 1 } },
  );
  if (!job) throw notFound("Import not found.");
  const rows = await collections.importRowErrors
    .find(
      { workspaceId: ctx.workspaceId, importJobId },
      { projection: { _id: 0, rowNumber: 1, reason: 1, raw: 1 } },
    )
    .sort({ rowNumber: 1 })
    .toArray();
  return rows;
}
