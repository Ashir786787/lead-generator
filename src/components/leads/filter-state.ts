import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import type { LeadQuery, SortOption } from "@/lib/data/filters";

export type TriState = "" | "true" | "false";

export interface LeadFilterState {
  q: string;
  city: string;
  status: string;
  category: string;
  minScore: string;
  hasWebsite: TriState;
  hasEmail: TriState;
  hasWhatsapp: TriState;
  scanOutcome: string;
  chatbot: string;
  followUp: string;
  includeArchived: boolean;
  includeDnc: boolean;
  sort: SortOption;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: LeadFilterState = {
  q: "",
  city: "",
  status: "",
  category: "",
  minScore: "",
  hasWebsite: "",
  hasEmail: "",
  hasWhatsapp: "",
  scanOutcome: "",
  chatbot: "",
  followUp: "",
  includeArchived: false,
  includeDnc: false,
  sort: "score_desc",
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

const SORTS: SortOption[] = [
  "score_desc",
  "score_asc",
  "name_asc",
  "name_desc",
  "city_asc",
  "last_checked_desc",
  "created_desc",
];

function tri(value: string | null): TriState {
  return value === "true" || value === "false" ? value : "";
}

export function filtersFromParams(params: URLSearchParams): LeadFilterState {
  const minScore = params.get("minScore") ?? "";
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  const sort = params.get("sort") as SortOption | null;
  return {
    q: params.get("q") ?? "",
    city: params.get("city") ?? "",
    status: params.get("status") ?? "",
    category: params.get("category") ?? "",
    minScore: minScore && /^\d{1,3}$/.test(minScore) ? minScore : "",
    hasWebsite: tri(params.get("hasWebsite")),
    hasEmail: tri(params.get("hasEmail")),
    hasWhatsapp: tri(params.get("hasWhatsapp")),
    scanOutcome: params.get("scanOutcome") ?? "",
    chatbot: params.get("chatbot") ?? "",
    followUp: params.get("followUp") ?? "",
    includeArchived: params.get("includeArchived") === "true",
    includeDnc: params.get("includeDnc") === "true",
    sort: sort && SORTS.includes(sort) ? sort : "score_desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

export function filtersToParams(filters: LeadFilterState, includePage = true): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value) params.set(key, value);
  };
  set("q", filters.q.trim());
  set("city", filters.city);
  set("status", filters.status);
  set("category", filters.category);
  set("minScore", filters.minScore);
  set("hasWebsite", filters.hasWebsite);
  set("hasEmail", filters.hasEmail);
  set("hasWhatsapp", filters.hasWhatsapp);
  set("scanOutcome", filters.scanOutcome);
  set("chatbot", filters.chatbot);
  set("followUp", filters.followUp);
  if (filters.includeArchived) params.set("includeArchived", "true");
  if (filters.includeDnc) params.set("includeDnc", "true");
  if (filters.sort !== "score_desc") params.set("sort", filters.sort);
  if (includePage) {
    if (filters.page > 1) params.set("page", String(filters.page));
    if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(filters.pageSize));
  }
  return params;
}

export function filtersToRecord(filters: LeadFilterState): Record<string, string> {
  return Object.fromEntries(filtersToParams(filters).entries());
}

export function activeFilterCount(filters: LeadFilterState): number {
  let count = 0;
  if (filters.q.trim()) count++;
  if (filters.city) count++;
  if (filters.status) count++;
  if (filters.category) count++;
  if (filters.minScore) count++;
  if (filters.hasWebsite) count++;
  if (filters.hasEmail) count++;
  if (filters.hasWhatsapp) count++;
  if (filters.scanOutcome) count++;
  if (filters.chatbot) count++;
  if (filters.followUp) count++;
  if (filters.includeArchived) count++;
  if (filters.includeDnc) count++;
  return count;
}

export function queryForApi(filters: LeadFilterState): string {
  return filtersToParams(filters).toString();
}

export function asLeadQuery(filters: LeadFilterState): Partial<LeadQuery> {
  return Object.fromEntries(filtersToParams(filters).entries());
}
