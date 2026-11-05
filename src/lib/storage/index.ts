import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { safeFilename } from "@/lib/utils";

export const storageRoot = path.resolve(env.storageDir);
const projectRoot = process.cwd();

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(path.join(storageRoot, "uploads"), { recursive: true });
  await fs.mkdir(path.join(storageRoot, "exports"), { recursive: true });
  await fs.mkdir(path.join(storageRoot, "tmp"), { recursive: true });
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function saveUpload(
  workspaceId: string,
  filename: string,
  buffer: Buffer,
): Promise<{ storedPath: string; absolutePath: string; hash: string; safeName: string }> {
  await ensureStorage();
  const hash = hashBuffer(buffer);
  const safeName = safeFilename(filename);
  const dir = path.join(storageRoot, "uploads", workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, `${hash.slice(0, 16)}-${safeName}`);
  await fs.writeFile(absolutePath, buffer);
  return {
    storedPath: path.relative(process.cwd(), absolutePath),
    absolutePath,
    hash,
    safeName,
  };
}

/** Resolve a stored path, refusing anything outside the storage directory. */
export function resolveStoredPath(storedPath: string): string {
  const absolute = path.isAbsolute(storedPath)
    ? storedPath
    : // Paths come from stored import records, so this is intentionally dynamic.
      path.resolve(/*turbopackIgnore: true*/ projectRoot, storedPath);
  const relative = path.relative(storageRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to read a file outside the storage directory.");
  }
  return absolute;
}

export function exportPath(workspaceId: string, name: string): { absolute: string; stored: string } {
  const safe = safeFilename(name);
  const absolute = path.join(storageRoot, "exports", workspaceId, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
  return { absolute, stored: path.relative(process.cwd(), absolute) };
}
