import { collections, newId, now } from "@/lib/db";
import type { ExportJobDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { buildLeadWhere } from "@/lib/data/leads";
import { parseLeadQuery, type LeadQuery } from "@/lib/data/filters";
import { CHATBOT_LABELS, PIPELINE_STATUS_LABELS, SCAN_OUTCOME_LABELS } from "@/lib/constants";
import { publishEvent } from "@/lib/events/bus";
import { safeFilename } from "@/lib/utils";

const MAX_EXPORT_ROWS = 50_000;

export interface ExportResult {
  filename: string;
  csv: string;
  rowCount: number;
  exportJobId: string;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export async function exportLeadsCsv(
  ctx: WorkspaceContext,
  rawQuery: Record<string, string>,
  options: { includeNotes?: boolean; includeDnc?: boolean } = {},
): Promise<ExportResult> {
  const query: LeadQuery = parseLeadQuery({
    ...rawQuery,
    page: "1",
    pageSize: "100",
    includeDnc: options.includeDnc ? "true" : rawQuery.includeDnc,
    includeArchived: rawQuery.includeArchived,
  });

  const rows = await collections.businesses
    .find(buildLeadWhere(ctx.workspaceId, query))
    .sort({ latestScore: -1, normalizedName: 1 })
    .limit(MAX_EXPORT_ROWS)
    .toArray();

  const ids = rows.map((row) => row._id);
  const [contactRows, tagLinks, sourceRows] = ids.length
    ? await Promise.all([
        collections.contactPoints
          .find(
            { workspaceId: ctx.workspaceId, businessId: { $in: ids } },
            { projection: { _id: 0, businessId: 1, type: 1, value: 1, platform: 1 } },
          )
          .toArray(),
        collections.businessTags
          .find(
            { workspaceId: ctx.workspaceId, businessId: { $in: ids } },
            { projection: { _id: 0, businessId: 1, tagId: 1 } },
          )
          .toArray(),
        collections.sourceRecords
          .find(
            { workspaceId: ctx.workspaceId, businessId: { $in: ids } },
            { projection: { _id: 0, businessId: 1, source: 1, sourceId: 1 } },
          )
          .toArray(),
      ])
    : [[], [], []];

  const tagIds = [...new Set(tagLinks.map((link) => link.tagId))];
  const tagRows = tagIds.length
    ? await collections.tags
        .find({ _id: { $in: tagIds } }, { projection: { _id: 1, name: 1 } })
        .toArray()
    : [];
  const tagNameById = new Map(tagRows.map((tag) => [tag._id, tag.name]));

  const contacts = new Map<string, { email: string[]; phone: string[]; whatsapp: string[]; other: string[] }>();
  for (const contact of contactRows) {
    const entry = contacts.get(contact.businessId) ?? { email: [], phone: [], whatsapp: [], other: [] };
    if (contact.type === "email") entry.email.push(contact.value);
    else if (contact.type === "phone") entry.phone.push(contact.value);
    else if (contact.type === "whatsapp") entry.whatsapp.push(contact.value);
    else entry.other.push(`${contact.platform ?? contact.type}: ${contact.value}`);
    contacts.set(contact.businessId, entry);
  }
  const tagMap = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagNameById.get(link.tagId);
    if (!name) continue;
    tagMap.set(link.businessId, [...(tagMap.get(link.businessId) ?? []), name]);
  }
  const sourceMap = new Map<string, string[]>();
  for (const source of sourceRows) {
    sourceMap.set(source.businessId, [
      ...(sourceMap.get(source.businessId) ?? []),
      `${source.source}:${source.sourceId}`,
    ]);
  }

  const header = [
    "Business name",
    "Category",
    "City",
    "Country",
    "Street",
    "Phone",
    "Email",
    "Website",
    "Pipeline status",
    "Opportunity score",
    "Chatbot finding",
    "Website check",
    "Additional phone",
    "Additional email",
    "WhatsApp links",
    "Other contact points",
    "Social / other",
    "Tags",
    "Follow-up date",
    "Do not contact",
    "Sources",
    "Last checked at",
    "Created at",
  ];
  if (options.includeNotes) header.push("Notes");

  const lines = [csvLine(header)];
  for (const row of rows) {
    const contact = contacts.get(row._id);
    const values: unknown[] = [
      row.name,
      row.category ?? row.categoryKey ?? "",
      row.city ?? "",
      row.country ?? "",
      row.street ?? "",
      row.phone ?? "",
      row.email ?? "",
      row.websiteUrl ?? "",
      PIPELINE_STATUS_LABELS[row.status],
      row.latestScore ?? "",
      row.latestChatbotResult ? CHATBOT_LABELS[row.latestChatbotResult] : "Unknown",
      row.latestScanOutcome
        ? SCAN_OUTCOME_LABELS[row.latestScanOutcome] ?? row.latestScanOutcome
        : "Not scanned",
      contact?.phone.slice(1).join(" | ") ?? "",
      contact?.email.slice(0, 1).join(" | ") ?? "",
      contact?.whatsapp.join(" | ") ?? "",
      contact?.other.join(" | ") ?? "",
      "",
      (tagMap.get(row._id) ?? []).join(" | "),
      row.followUpAt ? row.followUpAt.toISOString().slice(0, 10) : "",
      row.doNotContact ? "Yes" : "No",
      (sourceMap.get(row._id) ?? []).join(" | "),
      row.lastCheckedAt ? row.lastCheckedAt.toISOString() : "",
      row.createdAt.toISOString(),
    ];
    if (options.includeNotes) values.push(row.notes ?? "");
    lines.push(csvLine(values));
  }

  const csv = `${lines.join("\r\n")}\r\n`;
  const timestamp = now();
  const exportJob: ExportJobDoc = {
    _id: newId(),
    workspaceId: ctx.workspaceId,
    createdBy: ctx.user.id,
    status: "completed",
    filters: query as unknown as Record<string, string>,
    includeNotes: Boolean(options.includeNotes),
    includeDnc: Boolean(options.includeDnc),
    rowCount: rows.length,
    storagePath: null,
    error: null,
    createdAt: timestamp,
    finishedAt: timestamp,
  };
  await collections.exportJobs.insertOne(exportJob);

  await collections.activities.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
    businessId: null,
    type: "export_ready",
    message: `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"} to CSV`,
    metadata: { exportJobId: exportJob._id, rowCount: rows.length },
    actorId: ctx.user.id,
    createdAt: timestamp,
  });
  await publishEvent(ctx.workspaceId, "export.ready", { rowCount: rows.length });

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: safeFilename(`lead-finder-export-${stamp}.csv`),
    csv,
    rowCount: rows.length,
    exportJobId: exportJob._id,
  };
}

export async function listRecentExports(ctx: WorkspaceContext): Promise<
  Array<{ id: string; rowCount: number; createdAt: string; includeNotes: boolean; includeDnc: boolean }>
> {
  const rows = await collections.exportJobs
    .find(
      { workspaceId: ctx.workspaceId, error: null },
      {
        projection: {
          _id: 1,
          rowCount: 1,
          createdAt: 1,
          includeNotes: 1,
          includeDnc: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
  return rows.map((row) => ({
    id: row._id,
    rowCount: row.rowCount,
    createdAt: row.createdAt.toISOString(),
    includeNotes: row.includeNotes,
    includeDnc: row.includeDnc,
  }));
}
