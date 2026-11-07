import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GridFSBucket, ObjectId } from "mongodb";
import { mongoDb } from "@/lib/db";
import { env } from "@/lib/env";
import { safeFilename } from "@/lib/utils";

/**
 * Uploads and exports are stored in GridFS so they survive serverless
 * invocations. The local filesystem is only used to materialize a stream for
 * the CSV / ZIP parsers, and every caller removes its temp directory.
 */
export const storageRoot = path.resolve(env.storageDir);

const GRIDFS_PREFIX = "gridfs:";
const UPLOAD_BUCKET = "uploads";
const EXPORT_BUCKET = "exports";

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(path.join(storageRoot, "tmp"), { recursive: true });
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bucket(name: string): GridFSBucket {
  return new GridFSBucket(mongoDb, { bucketName: name });
}

function gridId(storedPath: string): ObjectId {
  if (!storedPath.startsWith(GRIDFS_PREFIX)) {
    throw new Error("Stored file is not in GridFS.");
  }
  const value = storedPath.slice(GRIDFS_PREFIX.length);
  if (!ObjectId.isValid(value)) throw new Error("Stored file id is invalid.");
  return new ObjectId(value);
}

async function uploadBuffer(
  bucketName: string,
  filename: string,
  buffer: Buffer,
  metadata: Record<string, unknown>,
): Promise<string> {
  const upload = bucket(bucketName).openUploadStream(filename, { metadata });
  await new Promise<void>((resolve, reject) => {
    upload.end(buffer, (error?: Error | null) => (error ? reject(error) : resolve()));
  });
  return `${GRIDFS_PREFIX}${upload.id.toString()}`;
}

export interface StoredUpload {
  storedPath: string;
  hash: string;
  safeName: string;
}

export async function saveUpload(
  workspaceId: string,
  filename: string,
  buffer: Buffer,
): Promise<StoredUpload> {
  const hash = hashBuffer(buffer);
  const safeName = safeFilename(filename);
  const storedPath = await uploadBuffer(
    UPLOAD_BUCKET,
    `${hash.slice(0, 16)}-${safeName}`,
    buffer,
    { workspaceId, safeName, kind: "upload" },
  );
  return { storedPath, hash, safeName };
}

export async function saveExport(
  workspaceId: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const safe = safeFilename(filename);
  return uploadBuffer(EXPORT_BUCKET, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`, buffer, {
    workspaceId,
    safeName: safe,
    kind: "export",
  });
}

export async function deleteStored(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath || !storedPath.startsWith(GRIDFS_PREFIX)) return;
  const id = gridId(storedPath);
  for (const name of [UPLOAD_BUCKET, EXPORT_BUCKET]) {
    try {
      await bucket(name).delete(id);
      return;
    } catch {
      /* try the next bucket */
    }
  }
}

/** Write a buffer to a temp file so the CSV / ZIP parsers can stream it. */
export async function writeTempFile(
  directory: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, safeFilename(filename));
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/** Download a GridFS upload to a temp file for the parsers. */
export async function materializeUpload(
  storedPath: string,
  directory: string,
  filename: string,
): Promise<string> {
  const id = gridId(storedPath);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, safeFilename(filename));
  await new Promise<void>((resolve, reject) => {
    const download = bucket(UPLOAD_BUCKET).openDownloadStream(id);
    const chunks: Buffer[] = [];
    download.on("data", (chunk: Buffer) => chunks.push(chunk));
    download.on("error", reject);
    download.on("end", () => {
      fs.writeFile(filePath, Buffer.concat(chunks)).then(() => resolve(), reject);
    });
  });
  return filePath;
}

export async function removeTempDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}
