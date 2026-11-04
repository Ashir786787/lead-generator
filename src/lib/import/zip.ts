import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl from "yauzl";
import { env } from "@/lib/env";

export interface ZipExtractResult {
  files: string[];
  skipped: string[];
  totalBytes: number;
  entries: number;
}

const SUPPORTED_EXTENSIONS = new Set([".csv", ".tsv", ".geojson", ".json"]);

function validateEntryName(fileName: string): string {
  if (!fileName || fileName.endsWith("/")) throw new Error("ZIP contains an empty entry name.");
  if (fileName.includes("\\")) throw new Error(`Unsafe ZIP entry (backslash): ${fileName}`);
  if (fileName.startsWith("/") || /^[a-zA-Z]:/.test(fileName)) {
    throw new Error(`Unsafe ZIP entry (absolute path): ${fileName}`);
  }
  const parts = fileName.split("/");
  if (parts.some((part) => part === ".." || part === ".")) {
    throw new Error(`Unsafe ZIP entry (path traversal): ${fileName}`);
  }
  if (fileName.includes("\0")) throw new Error("Unsafe ZIP entry (null byte).");
  return fileName;
}

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("Could not open ZIP file."));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Could not read ZIP entry."));
      else resolve(stream);
    });
  });
}

/**
 * Extract only supported data files, enforcing every limit from AGENTS.md:
 * traversal, symlinks, entry count, per-entry size, total size, compression ratio.
 */
export async function extractZipSafely(zipPath: string, destination: string): Promise<ZipExtractResult> {
  const zip = await openZip(zipPath);
  await fs.promises.mkdir(destination, { recursive: true });
  const files: string[] = [];
  const skipped: string[] = [];
  let entries = 0;
  let totalBytes = 0;

  try {
    while (true) {
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const cleanup = () => {
          zip.removeListener("entry", onEntry);
          zip.removeListener("end", onEnd);
          zip.removeListener("error", onError);
        };
        const onEntry = (value: yauzl.Entry) => {
          cleanup();
          resolve(value);
        };
        const onEnd = () => {
          cleanup();
          resolve(null);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        zip.readEntry();
      });
      if (!entry) break;
      entries++;
      if (entries > env.zip.maxEntries) {
        throw new Error(`ZIP has more than ${env.zip.maxEntries} entries.`);
      }
      if (entry.fileName.endsWith("/")) continue;

      const safeName = validateEntryName(entry.fileName);
      if (isSymlink(entry)) throw new Error(`ZIP contains a symlink: ${safeName}`);
      if (safeName.startsWith("__MACOSX/")) {
        skipped.push(safeName);
        continue;
      }
      const extension = path.extname(safeName).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        skipped.push(safeName);
        continue;
      }

      if (entry.uncompressedSize > env.zip.maxEntryUncompressed) {
        throw new Error(`ZIP entry exceeds the per-file limit: ${safeName}`);
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > env.zip.maxTotalUncompressed) {
        throw new Error("ZIP exceeds the total uncompressed size limit.");
      }
      if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > env.zip.maxCompressionRatio) {
        throw new Error(`Suspicious compression ratio in ${safeName}.`);
      }

      const target = path.resolve(destination, safeName);
      const relative = path.relative(destination, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Unsafe ZIP entry path: ${safeName}`);
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });

      const stream = await openEntryStream(zip, entry);
      let written = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          written += chunk.length;
          if (written > env.zip.maxEntryUncompressed) {
            callback(new Error(`ZIP entry expanded beyond the allowed size: ${safeName}`));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(stream, limiter, fs.createWriteStream(target, { flags: "wx" }));
      files.push(target);
    }
  } finally {
    zip.close();
  }

  return { files, skipped, totalBytes, entries };
}

/** Read a small preview of the first supported CSV/GeoJSON entry in a ZIP. */
export async function readZipPreviewEntry(zipPath: string): Promise<{
  fileName: string;
  buffer: Buffer;
} | null> {
  const zip = await openZip(zipPath);
  try {
    while (true) {
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const cleanup = () => {
          zip.removeListener("entry", onEntry);
          zip.removeListener("end", onEnd);
          zip.removeListener("error", onError);
        };
        const onEntry = (value: yauzl.Entry) => {
          cleanup();
          resolve(value);
        };
        const onEnd = () => {
          cleanup();
          resolve(null);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        zip.readEntry();
      });
      if (!entry) return null;
      if (entry.fileName.endsWith("/")) continue;
      const safeName = validateEntryName(entry.fileName);
      const extension = path.extname(safeName).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension) || entry.uncompressedSize === 0) continue;
      if (entry.uncompressedSize > 8 * 1024 * 1024) {
        throw new Error("The first data file in the ZIP is larger than the preview limit.");
      }
      const stream = await openEntryStream(zip, entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      return { fileName: safeName, buffer: Buffer.concat(chunks) };
    }
  } finally {
    zip.close();
  }
}
