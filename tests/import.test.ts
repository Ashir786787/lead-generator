import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { csvCell, detectDelimiter, previewCsv, streamCsv, toCsvLine } from "@/lib/import/csv";
import { applyMapping, guessMapping, mappingWarnings } from "@/lib/import/mapping";
import { extractZipSafely, readZipPreviewEntry } from "@/lib/import/zip";
import { buildZip } from "./helpers/zip";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "leadfinder-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CSV parsing", () => {
  it("detects comma, semicolon and tab delimiters", () => {
    expect(detectDelimiter("name,city,phone\nA,Dubai,+971")).toBe(",");
    expect(detectDelimiter("name;city;phone\nA;Dubai;+971")).toBe(";");
    expect(detectDelimiter("name\tcity\tphone\nA\tDubai\t+971")).toBe("\t");
  });

  it("ignores delimiters inside quoted fields", () => {
    expect(detectDelimiter('name,notes\nA,"one;two;three;four"\n')).toBe(",");
  });

  it("previews a BOM + semicolon file and streams every record", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "leads.csv");
    await fs.writeFile(
      file,
      "\uFEFFBusiness Name;City;Website\nCafé One;Dubai;cafe-one.example\nCafé Two;Sharjah;\n",
      "utf8",
    );

    const preview = await previewCsv(file, 1);
    expect(preview.columns).toEqual(["Business Name", "City", "Website"]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.["Business Name"]).toBe("Café One");

    const rows: Record<string, string>[] = [];
    for await (const row of streamCsv(file)) rows.push(row);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.City).toBe("Sharjah");
  });
});

describe("CSV export safety", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+971501234567")).toBe("'+971501234567");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Hello, "world"')).toBe('"Hello, ""world"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("keeps ordinary values untouched and joins a line", () => {
    expect(csvCell("Al Noor")).toBe("Al Noor");
    expect(csvCell(null)).toBe("");
    expect(toCsvLine(["A", 1, null, true])).toBe("A,1,,true");
  });
});

describe("column mapping", () => {
  const columns = [
    "Business Name",
    "Primary Category",
    "Website URL",
    "Phone Number",
    "E-mail",
    "Street",
    "City",
    "Country",
    "Latitude",
    "Longitude",
  ];

  it("guesses common aliases", () => {
    const mapping = guessMapping(columns);
    expect(mapping.name).toBe("Business Name");
    expect(mapping.category).toBe("Primary Category");
    expect(mapping.website).toBe("Website URL");
    expect(mapping.phone).toBe("Phone Number");
    expect(mapping.email).toBe("E-mail");
    expect(mapping.city).toBe("City");
    expect(mapping.lat).toBe("Latitude");
    expect(mapping.lng).toBe("Longitude");
  });

  it("applies a mapping and rejects out-of-range coordinates", () => {
    const mapping = guessMapping(columns);
    const valid = applyMapping(
      {
        "Business Name": " Al Noor ",
        "Website URL": "alnoor.example",
        City: "Dubai",
        Latitude: "25.2048",
        Longitude: "55.2708",
      },
      mapping,
    );
    expect(valid.name).toBe("Al Noor");
    expect(valid.lat).toBeCloseTo(25.2048);
    expect(valid.lng).toBeCloseTo(55.2708);

    const invalid = applyMapping(
      { "Business Name": "Bad Coords", Latitude: "91", Longitude: "181" },
      mapping,
    );
    expect(invalid.lat).toBeNull();
    expect(invalid.lng).toBeNull();
  });

  it("warns when essential fields are missing", () => {
    const warnings = mappingWarnings({ name: "name" });
    expect(warnings.some((warning) => warning.includes("city or coordinates"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("website"))).toBe(true);
    expect(mappingWarnings({}).some((warning) => warning.includes("name column"))).toBe(true);
  });
});

describe("ZIP safety", () => {
  it("extracts supported data files and skips unsupported ones", async () => {
    const dir = await tempDir();
    const zipPath = path.join(dir, "import.zip");
    await fs.writeFile(
      zipPath,
      buildZip([
        { name: "data/leads.csv", data: "name,city\nCafe One,Dubai\n", deflate: true },
        { name: "data/leads.tsv", data: "name\tcity\nCafe Two\tDubai\n" },
        { name: "readme.txt", data: "ignore me" },
        { name: "__MACOSX/._leads.csv", data: "junk" },
      ]),
    );

    const destination = path.join(dir, "extracted");
    const result = await extractZipSafely(zipPath, destination);

    expect(result.entries).toBe(4);
    expect(result.files).toHaveLength(2);
    expect(result.skipped).toEqual(["readme.txt", "__MACOSX/._leads.csv"]);
    const csv = await fs.readFile(path.join(destination, "data", "leads.csv"), "utf8");
    expect(csv).toContain("Cafe One");

    const preview = await readZipPreviewEntry(zipPath);
    expect(preview?.fileName).toBe("data/leads.csv");
    expect(preview?.buffer.toString("utf8")).toContain("Cafe One");
  });

  it("rejects path traversal instead of extracting outside the destination", async () => {
    const dir = await tempDir();
    const zipPath = path.join(dir, "traversal.zip");
    await fs.writeFile(zipPath, buildZip([{ name: "../evil.csv", data: "name\nEvil\n" }]));

    const destination = path.join(dir, "extracted");
    await expect(extractZipSafely(zipPath, destination)).rejects.toThrow(
      /path traversal|invalid relative path/i,
    );
    await expect(fs.stat(path.join(dir, "evil.csv"))).rejects.toThrow();
  });

  it("rejects absolute paths, backslashes and symlinks", async () => {
    const dir = await tempDir();
    const cases: Array<{ name: string; data: string; mode?: number; pattern: RegExp }> = [
      { name: "/evil.csv", data: "name\nEvil\n", pattern: /absolute path/i },
      { name: "C:\\evil.csv", data: "name\nEvil\n", pattern: /absolute path|backslash/i },
      { name: "link.csv", data: "", mode: 0o120000, pattern: /symlink/i },
    ];

    for (const [index, entry] of cases.entries()) {
      const zipPath = path.join(dir, `unsafe-${index}.zip`);
      await fs.writeFile(
        zipPath,
        buildZip([{ name: entry.name, data: entry.data, mode: entry.mode }]),
      );
      await expect(
        extractZipSafely(zipPath, path.join(dir, `out-${index}`)),
        entry.name,
      ).rejects.toThrow(entry.pattern);
    }
  });
});
