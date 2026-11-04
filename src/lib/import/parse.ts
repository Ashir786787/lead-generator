import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { previewCsv, streamCsv, type CsvRecord } from "./csv";
import { extractZipSafely, readZipPreviewEntry } from "./zip";
import { storageRoot } from "@/lib/storage";

export interface ParsedRecord {
  rowNumber: number;
  sourceFile: string;
  record: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface FilePreview {
  kind: "csv" | "geojson" | "zip";
  columns: string[];
  rows: Record<string, unknown>[];
  files?: string[];
  notes: string[];
}

export function supportedExtension(filename: string): boolean {
  return [".csv", ".tsv", ".geojson", ".json", ".zip"].includes(
    path.extname(filename).toLowerCase(),
  );
}

function flatten(value: unknown, prefix = "", depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (depth > 4 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    const primitives = value.filter(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    if (primitives.length) out[prefix] = primitives.join(", ");
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, depth + 1, out);
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function featureToRecord(feature: Record<string, unknown>): Record<string, unknown> {
  const geometry = feature.geometry as { coordinates?: unknown } | null;
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const flat = flatten(properties);
  const record: Record<string, unknown> = { ...flat };

  const names = properties.names as Record<string, unknown> | undefined;
  if (!record.name && names) record.name = pickString(names.primary) ?? pickString(names.common);
  const categories = properties.categories as Record<string, unknown> | undefined;
  if (!record.category && categories) {
    record.category = pickString(categories.primary);
  }
  if (!record.website) {
    const websites = properties.websites;
    if (Array.isArray(websites)) record.website = pickString(websites[0]);
  }
  if (!record.phone && Array.isArray(properties.phones)) record.phone = pickString(properties.phones[0]);
  if (!record.email && Array.isArray(properties.emails)) record.email = pickString(properties.emails[0]);
  const addresses = properties.addresses;
  if (Array.isArray(addresses) && addresses[0] && typeof addresses[0] === "object") {
    const address = addresses[0] as Record<string, unknown>;
    if (!record.street) record.street = pickString(address.freeform) ?? pickString(address.street);
    if (!record.city) record.city = pickString(address.locality) ?? pickString(address.city);
    if (!record.country) record.country = pickString(address.country);
    if (!record.area) record.area = pickString(address.region) ?? pickString(address.district);
  }
  if (!record.sourceId) record.sourceId = pickString(properties.id) ?? pickString(feature.id as string);
  if (geometry && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const [lng, lat] = geometry.coordinates as [unknown, unknown];
    if (typeof lat === "number" && typeof lng === "number" && !record.lat && !record.lng) {
      record.lat = lat;
      record.lng = lng;
    }
  }
  return record;
}

async function readGeoJsonRecords(filePath: string): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("This JSON file is not valid GeoJSON. Expected a FeatureCollection.");
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  if (typeof parsed === "object" && parsed !== null) {
    const object = parsed as Record<string, unknown>;
    if (object.type === "FeatureCollection" && Array.isArray(object.features)) {
      return object.features
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map(featureToRecord);
    }
    if (object.type === "Feature") return [featureToRecord(object)];
  }
  throw new Error("Unsupported JSON structure. Expected a GeoJSON FeatureCollection or Feature.");
}

async function looksLikeGeoJson(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8").trimStart();
    return sample.startsWith("{") || sample.startsWith("[");
  } finally {
    await handle.close();
  }
}

export async function previewFile(filePath: string, originalName: string): Promise<FilePreview> {
  const extension = path.extname(originalName).toLowerCase();
  if (!supportedExtension(originalName)) {
    throw new Error(
      `Unsupported file type “${extension || "unknown"}”. Supported files: .csv, .tsv, .geojson, .json, .zip.`,
    );
  }

  if (extension === ".zip") {
    const first = await readZipPreviewEntry(filePath);
    if (!first) {
      throw new Error("No supported CSV or GeoJSON file was found inside the ZIP archive.");
    }
    const tmpDir = path.join(storageRoot, "tmp", `preview-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, path.basename(first.fileName));
    try {
      await fs.writeFile(tmpPath, first.buffer);
      const inner = await previewFile(tmpPath, first.fileName);
      return {
        ...inner,
        kind: "zip",
        files: [first.fileName],
        notes: [
          ...inner.notes,
          "ZIP preview uses the first CSV/GeoJSON entry. All supported entries are processed on import.",
        ],
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  if (extension === ".geojson" || (extension === ".json" && (await looksLikeGeoJson(filePath)))) {
    const records = await readGeoJsonRecords(filePath);
    const columns = new Set<string>();
    for (const record of records.slice(0, 50)) {
      for (const key of Object.keys(record)) columns.add(key);
    }
    return {
      kind: "geojson",
      columns: [...columns],
      rows: records.slice(0, 10),
      notes: [
        "GeoJSON properties were detected automatically; known Overture-style fields skip the mapping step.",
      ],
    };
  }

  if (extension === ".json") {
    throw new Error("This .json file is not GeoJSON (expected a FeatureCollection).");
  }

  const preview = await previewCsv(filePath, 10);
  return {
    kind: "csv",
    columns: preview.columns,
    rows: preview.rows,
    notes: [],
  };
}

/**
 * Re-open the stored file and yield every record. ZIP archives are extracted
 * into a workspace-scoped temp directory and cleaned up by the caller.
 */
export async function* iterateFile(
  filePath: string,
  originalName: string,
  workDir: string,
): AsyncGenerator<ParsedRecord> {
  const extension = path.extname(originalName).toLowerCase();
  if (extension === ".zip") {
    const destination = path.join(workDir, "zip");
    const result = await extractZipSafely(filePath, destination);
    if (!result.files.length) {
      throw new Error(
        `No supported data files were found in the ZIP (found ${result.skipped.length} other entries).`,
      );
    }
    for (const file of result.files) {
      const innerExtension = path.extname(file).toLowerCase();
      if (innerExtension === ".json" && !(await looksLikeGeoJson(file))) {
        continue;
      }
      for await (const record of iterateFile(file, path.basename(file), workDir)) {
        yield record;
      }
    }
    return;
  }

  if (extension === ".geojson" || (extension === ".json" && (await looksLikeGeoJson(filePath)))) {
    const records = await readGeoJsonRecords(filePath);
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!record) continue;
      yield { rowNumber: index + 1, sourceFile: path.basename(originalName), record, raw: record };
    }
    return;
  }

  if (extension === ".json") {
    throw new Error("This .json file is not GeoJSON (expected a FeatureCollection).");
  }

  let rowNumber = 0;
  for await (const record of streamCsv(filePath)) {
    rowNumber++;
    yield {
      rowNumber,
      sourceFile: path.basename(originalName),
      record: record as CsvRecord,
      raw: record as Record<string, unknown>,
    };
  }
}

export async function countRowsHint(filePath: string): Promise<number | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".zip") return null;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > 50 * 1024 * 1024) return null;
  } catch {
    return null;
  }
  try {
    let newlines = 0;
    for await (const chunk of createReadStream(filePath)) {
      const buffer = Buffer.from(chunk as Buffer);
      for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] === 0x0a) newlines++;
      }
    }
    return Math.max(1, newlines);
  } catch {
    return null;
  }
}
