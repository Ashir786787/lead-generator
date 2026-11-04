import { z } from "zod";

export const SORT_OPTIONS = [
  "score_desc",
  "score_asc",
  "name_asc",
  "name_desc",
  "city_asc",
  "last_checked_desc",
  "created_desc",
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

export const leadQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  ids: z.string().max(4000).optional(),
  city: z.string().max(120).optional(),
  status: z.string().max(300).optional(),
  category: z.string().max(300).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  hasWebsite: booleanish.optional(),
  hasEmail: booleanish.optional(),
  hasWhatsapp: booleanish.optional(),
  scanOutcome: z.string().max(200).optional(),
  chatbot: z.enum(["detected", "not_detected", "unknown"]).optional(),
  followUp: z.enum(["overdue", "today", "any"]).optional(),
  includeArchived: booleanish.optional(),
  includeDnc: booleanish.optional(),
  sort: z.enum(SORT_OPTIONS).default("score_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type LeadQuery = z.infer<typeof leadQuerySchema>;

export function parseLeadQuery(params: URLSearchParams | Record<string, string | undefined>): LeadQuery {
  const raw =
    params instanceof URLSearchParams
      ? Object.fromEntries(params.entries())
      : Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "" || value === undefined || value === null) continue;
    cleaned[key] = value;
  }
  return leadQuerySchema.parse(cleaned);
}

export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function buildQueryString(query: Partial<LeadQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** Active filter count shown next to "Clear filters". */
export function countActiveFilters(query: LeadQuery): number {
  let count = 0;
  if (query.q) count++;
  if (query.ids) count++;
  if (query.city) count++;
  if (query.status) count++;
  if (query.category) count++;
  if (query.minScore !== undefined || query.maxScore !== undefined) count++;
  if (query.hasWebsite !== undefined) count++;
  if (query.hasEmail !== undefined) count++;
  if (query.hasWhatsapp !== undefined) count++;
  if (query.scanOutcome) count++;
  if (query.chatbot) count++;
  if (query.followUp) count++;
  return count;
}
