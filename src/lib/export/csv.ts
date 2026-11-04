import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  businesses,
  businessTags,
  contactPoints,
  exportJobs,
  sourceRecords,
  tags,
} from "@/lib/db/schema";
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

  const conditions = buildLeadWhere(ctx.workspaceId, query);
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      category: businesses.category,
      categoryKey: businesses.categoryKey,
      city: businesses.city,
      country: businesses.country,
      street: businesses.street,
      phone: businesses.phone,
      email: businesses.email,
      website: businesses.websiteUrl,
      status: businesses.status,
      score: businesses.latestScore,
      chatbot: businesses.latestChatbotResult,
      scan: businesses.latestScanOutcome,
      followUpAt: businesses.followUpAt,
      doNotContact: businesses.doNotContact,
      notes: businesses.notes,
      lastCheckedAt: businesses.lastCheckedAt,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(and(...conditions))
    .orderBy(desc(businesses.latestScore), asc(businesses.normalizedName))
    .limit(MAX_EXPORT_ROWS);

  const ids = rows.map((row) => row.id);
  const [contactRows, tagRows, sourceRows] = ids.length
    ? await Promise.all([
        db
          .select({
            businessId: contactPoints.businessId,
            type: contactPoints.type,
            value: contactPoints.value,
            platform: contactPoints.platform,
          })
          .from(contactPoints)
          .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), inArray(contactPoints.businessId, ids))),
        db
          .select({ businessId: businessTags.businessId, name: tags.name })
          .from(businessTags)
          .innerJoin(tags, eq(tags.id, businessTags.tagId))
          .where(and(eq(businessTags.workspaceId, ctx.workspaceId), inArray(businessTags.businessId, ids))),
        db
          .select({ businessId: sourceRecords.businessId, source: sourceRecords.source, sourceId: sourceRecords.sourceId })
          .from(sourceRecords)
          .where(and(eq(sourceRecords.workspaceId, ctx.workspaceId), inArray(sourceRecords.businessId, ids))),
      ])
    : [[], [], []];

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
  for (const tag of tagRows) tagMap.set(tag.businessId, [...(tagMap.get(tag.businessId) ?? []), tag.name]);
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
    const contact = contacts.get(row.id);
    const values: unknown[] = [
      row.name,
      row.category ?? row.categoryKey ?? "",
      row.city ?? "",
      row.country ?? "",
      row.street ?? "",
      row.phone ?? "",
      row.email ?? "",
      row.website ?? "",
      PIPELINE_STATUS_LABELS[row.status],
      row.score ?? "",
      row.chatbot ? CHATBOT_LABELS[row.chatbot] : "Unknown",
      row.scan ? SCAN_OUTCOME_LABELS[row.scan] ?? row.scan : "Not scanned",
      contact?.phone.slice(1).join(" | ") ?? "",
      contact?.email.slice(0, 1).join(" | ") ?? "",
      contact?.whatsapp.join(" | ") ?? "",
      contact?.other.join(" | ") ?? "",
      "",
      (tagMap.get(row.id) ?? []).join(" | "),
      row.followUpAt ? row.followUpAt.toISOString().slice(0, 10) : "",
      row.doNotContact ? "Yes" : "No",
      (sourceMap.get(row.id) ?? []).join(" | "),
      row.lastCheckedAt ? row.lastCheckedAt.toISOString() : "",
      row.createdAt.toISOString(),
    ];
    if (options.includeNotes) values.push(row.notes ?? "");
    lines.push(csvLine(values));
  }

  const csv = `${lines.join("\r\n")}\r\n`;
  const [exportJob] = await db
    .insert(exportJobs)
    .values({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.user.id,
      status: "completed",
      filters: query as unknown as Record<string, string>,
      includeNotes: Boolean(options.includeNotes),
      includeDnc: Boolean(options.includeDnc),
      rowCount: rows.length,
      finishedAt: new Date(),
    })
    .returning({ id: exportJobs.id });

  await db.insert(activities).values({
    workspaceId: ctx.workspaceId,
    businessId: null,
    type: "export_ready",
    message: `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"} to CSV`,
    actorId: ctx.user.id,
  });
  await publishEvent(ctx.workspaceId, "export.ready", { rowCount: rows.length });

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: safeFilename(`lead-finder-export-${stamp}.csv`),
    csv,
    rowCount: rows.length,
    exportJobId: exportJob?.id ?? "",
  };
}

export async function listRecentExports(ctx: WorkspaceContext): Promise<
  Array<{ id: string; rowCount: number; createdAt: string; includeNotes: boolean; includeDnc: boolean }>
> {
  const rows = await db
    .select({
      id: exportJobs.id,
      rowCount: exportJobs.rowCount,
      createdAt: exportJobs.createdAt,
      includeNotes: exportJobs.includeNotes,
      includeDnc: exportJobs.includeDnc,
    })
    .from(exportJobs)
    .where(and(eq(exportJobs.workspaceId, ctx.workspaceId), isNull(exportJobs.error)))
    .orderBy(desc(exportJobs.createdAt))
    .limit(10);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
