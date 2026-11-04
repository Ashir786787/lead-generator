import fs from "node:fs";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

export type CsvRecord = Record<string, string>;

export function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t"];
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const char of sample) {
    if (char === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    if (counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
    else if (candidates.includes(char)) counts.set(char, 1);
  }
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    const value = counts.get(candidate) ?? 0;
    if (value > bestCount) {
      best = candidate;
      bestCount = value;
    }
  }
  return best;
}

export function sniffDelimiterFromFile(filePath: string): string {
  const buffer = Buffer.alloc(8192);
  const fd = fs.openSync(filePath, "r");
  try {
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytes).toString("utf8");
    if (filePath.toLowerCase().endsWith(".tsv")) return "\t";
    return detectDelimiter(sample);
  } finally {
    fs.closeSync(fd);
  }
}

function normaliseHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

export interface CsvPreview {
  columns: string[];
  rows: CsvRecord[];
}

export async function previewCsv(filePath: string, limit = 10): Promise<CsvPreview> {
  const delimiter = sniffDelimiterFromFile(filePath);
  const rows: CsvRecord[] = [];
  const columns: string[] = [];
  const parser = createReadStream(filePath).pipe(
    parse({
      bom: true,
      delimiter,
      columns: (header: string[]) => {
        const cleaned = header.map(normaliseHeader);
        columns.push(...cleaned);
        return cleaned;
      },
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    }),
  );
  for await (const record of parser) {
    rows.push(record as CsvRecord);
    if (rows.length >= limit) {
      parser.destroy();
      break;
    }
  }
  return { columns: [...new Set(columns)], rows };
}

export async function* streamCsv(filePath: string): AsyncGenerator<CsvRecord> {
  const delimiter = sniffDelimiterFromFile(filePath);
  const parser = createReadStream(filePath).pipe(
    parse({
      bom: true,
      delimiter,
      columns: (header: string[]) => header.map(normaliseHeader),
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    }),
  );
  try {
    for await (const record of parser) yield record as CsvRecord;
  } finally {
    parser.destroy();
  }
}

/** Excel-safe CSV line with formula-injection neutralisation. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
