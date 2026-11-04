import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { importJobs, savedSearches } from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { conflict, notFound } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { hashText } from "@/lib/storage";
import { ingestRecords, finalizeImportJob, type IngestCounts } from "@/lib/import/ingest";
import type { ColumnMapping } from "@/lib/import/mapping";
import { logger } from "@/lib/logger";
import { CATEGORY_OPTIONS } from "@/lib/constants";
import type { CategoryKey } from "@/lib/score/types";

export type DiscoveryProvider = "osm" | "google_places";

export interface DiscoveryRequest {
  provider: DiscoveryProvider;
  country: string;
  city: string;
  categories: CategoryKey[];
  limit: number;
}

export interface DiscoveryProviderStatus {
  id: DiscoveryProvider;
  label: string;
  available: boolean;
  detail: string;
  attribution: string;
}

export function providerStatuses(): DiscoveryProviderStatus[] {
  return [
    {
      id: "osm",
      label: "OpenStreetMap (Overpass)",
      available: true,
      detail:
        "Live public business listings from OpenStreetMap. No API key needed. Please keep searches small — Overpass is a shared community service.",
      attribution: "© OpenStreetMap contributors (ODbL)",
    },
    {
      id: "google_places",
      label: "Google Places",
      available: Boolean(env.googlePlaces.apiKey),
      detail: env.googlePlaces.apiKey
        ? `Connected with your API key. Text Search returns up to 20 places per search (daily budget cap ${env.googlePlaces.dailyBudget} calls).`
        : "Unavailable — add GOOGLE_PLACES_API_KEY to enable this provider. No placeholder results are shown.",
      attribution: "Google Places API",
    },
  ];
}

const OSM_FILTERS: Record<CategoryKey, string[]> = {
  restaurant: ['["amenity"~"^(restaurant|fast_food)$"]'],
  cafe: ['["amenity"="cafe"]'],
  clinic: ['["amenity"~"^(clinic|doctors|hospital)$"]'],
  dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  salon: ['["shop"~"^(hairdresser|beauty)$"]'],
  spa: ['["leisure"="spa"]', '["shop"="massage"]', '["amenity"="spa"]'],
  gym: ['["leisure"~"^(fitness_centre|sports_centre)$"]'],
  hotel: ['["tourism"~"^(hotel|guest_house|hostel)$"]'],
  real_estate: ['["office"="estate_agent"]'],
  law_firm: ['["office"="lawyer"]'],
  accounting: ['["office"="accountant"]'],
  education: ['["amenity"~"^(school|college|university|driving_school)$"]'],
  ecommerce: ['["shop"="copyshop"]'],
  retail: ['["shop"]'],
  automotive: ['["shop"~"^(car|car_repair|car_parts|tyres)$"]'],
  construction: ['["craft"~"^(builder|carpenter|electrician|plumber|painter)$"]', '["office"="construction_company"]'],
  travel: ['["shop"="travel_agency"]', '["office"="travel_agent"]'],
  other: [],
};

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 120);
}

function buildOverpassQuery(request: DiscoveryRequest): string {
  const areaMatchers = request.categories.flatMap((category) => OSM_FILTERS[category] ?? []);
  const unique = [...new Set(areaMatchers)];
  if (!unique.length) {
    throw conflict("Choose at least one category that OpenStreetMap discovery supports.");
  }
  const city = escapeRegex(request.city);
  const country = escapeRegex(request.country);
  const lines = [
    "[out:json][timeout:45]",
    `area["name"~"^${city}$",i]["boundary"="administrative"]->.searchArea;`,
  ];
  if (country) {
    lines.push(`area["name"~"^${country}$",i]["boundary"="administrative"]->.countryArea;`);
  }
  lines.push("(");
  for (const filter of unique) {
    lines.push(`  nwr${filter}${country ? "(area.searchArea)(area.countryArea)" : "(area.searchArea)"};`);
  }
  lines.push(");");
  lines.push(`out center tags ${Math.min(200, Math.max(1, request.limit))};`);
  return lines.join("\n");
}

/** Public Overpass mirrors, in priority order, with duplicates removed. */
export function overpassEndpoints(): string[] {
  return [...new Set([env.overpass.endpoint, ...env.overpass.endpoints].filter(Boolean))];
}

interface OverpassCacheEntry {
  expiresAt: number;
  records: Record<string, unknown>[];
}

const overpassCache = new Map<string, OverpassCacheEntry>();
const OVERPASS_CACHE_LIMIT = 120;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfterMs = 0): number {
  // Keep tests instant; production backs off politely when a mirror is busy.
  const base = env.isTest ? 1 : 1500;
  return Math.max(retryAfterMs, Math.min(8000, base * 2 ** attempt));
}

function readCachedOverpass(key: string): Record<string, unknown>[] | null {
  const entry = overpassCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    overpassCache.delete(key);
    return null;
  }
  return entry.records.map((record) => ({ ...record }));
}

function writeCachedOverpass(key: string, records: Record<string, unknown>[]): void {
  if (env.overpass.cacheMinutes <= 0) return;
  if (overpassCache.size >= OVERPASS_CACHE_LIMIT) {
    const oldest = overpassCache.keys().next().value;
    if (oldest) overpassCache.delete(oldest);
  }
  overpassCache.set(key, {
    expiresAt: Date.now() + env.overpass.cacheMinutes * 60_000,
    records: records.map((record) => ({ ...record })),
  });
}

/** Test helper: clear the in-memory discovery caches between cases. */
export function clearDiscoveryCaches(): void {
  overpassCache.clear();
}

type AttemptFailure = {
  endpoint: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
};

function overpassErrorDetail(status: number, body: string): string {
  if (/at capacity|queue is full|too many requests/i.test(body)) return `HTTP ${status} (server at capacity)`;
  if (/whitelist|not allowed|forbidden/i.test(body)) return `HTTP ${status} (mirror refused this client)`;
  if (/timed?\s*out/i.test(body)) return `HTTP ${status} (query timed out)`;
  return `HTTP ${status}`;
}

async function fetchOverpassOnce(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[] | AttemptFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": env.scan.userAgent,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        endpoint,
        message: overpassErrorDetail(response.status, body),
        retryable: isRetryableStatus(response.status),
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(15_000, retryAfter * 1000) : undefined,
      };
    }
    const payload = (await response.json()) as OverpassResponse;
    const elements = payload.elements ?? [];
    if (!elements.length && payload.remark && /(error|timed?\s*out|too many)/i.test(payload.remark)) {
      return { endpoint, message: payload.remark.slice(0, 180), retryable: true };
    }
    return parseOverpassElements(elements);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { endpoint, message: `timed out after ${Math.round(timeoutMs / 1000)}s`, retryable: true };
    }
    return {
      endpoint,
      message: error instanceof Error ? error.message.slice(0, 180) : "network error",
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseOverpassElements(elements: OverpassElement[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const street =
      [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") ||
      tags["addr:full"] ||
      null;
    records.push({
      name,
      category:
        tags.cuisine ??
        tags.amenity ??
        tags.shop ??
        tags.office ??
        tags.tourism ??
        tags.leisure ??
        "other",
      website: tags.website ?? tags["contact:website"] ?? null,
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      email: tags.email ?? tags["contact:email"] ?? null,
      street,
      area: tags["addr:suburb"] ?? tags["addr:district"] ?? null,
      // City/country come from the request below so OSM records without address
      // tags keep the searched location.
      city: tags["addr:city"] ?? null,
      country: tags["addr:country"] ?? null,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lon === "number" ? lon : null,
      sourceId: `osm:${element.type}/${element.id}`,
    });
  }
  return records;
}

async function runOverpass(request: DiscoveryRequest): Promise<Record<string, unknown>[]> {
  const query = buildOverpassQuery(request);
  const cacheKey = hashText(query);
  const cached = readCachedOverpass(cacheKey);
  if (cached) {
    logger.info({ provider: "osm", cached: true }, "Discovery cache hit");
    return cached.map((record) => ({
      ...record,
      city: record.city ?? request.city,
      country: record.country ?? request.country,
    }));
  }

  const endpoints = overpassEndpoints();
  const attemptsPerEndpoint = Math.min(3, Math.max(0, env.overpass.retries)) + 1;
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(60_000, env.overpass.timeoutMs * 2);
  const failures: AttemptFailure[] = [];

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < attemptsPerEndpoint; attempt++) {
      if (Date.now() > deadline) break;
      const remaining = deadline - Date.now();
      const perAttempt = Math.max(10_000, Math.min(env.overpass.timeoutMs, remaining));
      const outcome = await fetchOverpassOnce(endpoint, query, perAttempt);
      if (Array.isArray(outcome)) {
        const records = outcome.map((record) => ({
          ...record,
          city: record.city ?? request.city,
          country: record.country ?? request.country,
        }));
        writeCachedOverpass(cacheKey, records);
        logger.info(
          { provider: "osm", endpoint, attempts: failures.length + 1, ms: Date.now() - startedAt },
          "Discovery source responded",
        );
        return records;
      }
      failures.push(outcome);
      logger.warn(
        { provider: "osm", endpoint, attempt: attempt + 1, reason: outcome.message },
        "Overpass attempt failed",
      );
      if (!outcome.retryable) break;
      if (attempt + 1 < attemptsPerEndpoint) {
        await sleep(retryDelayMs(attempt, outcome.retryAfterMs));
      }
    }
    if (Date.now() > deadline) break;
  }

  const last = failures.at(-1);
  const summary = last
    ? `${last.message} from ${safeHost(last.endpoint)}`
    : "no endpoint configured";
  const mirrorHint =
    endpoints.length > 1 ? "" : " Add another mirror with OVERPASS_ENDPOINTS for automatic fallback.";
  throw conflict(
    `OpenStreetMap could not be reached after ${failures.length} attempt${failures.length === 1 ? "" : "s"} (${summary}). This is usually temporary upstream overload — retry in a minute, pick a smaller area, or use Google Places if configured.${mirrorHint}`,
  );
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** Public wrapper used by tests and runDiscovery; keeps retry/cache behaviour in one place. */
export async function searchOsmRecords(
  request: DiscoveryRequest,
): Promise<Record<string, unknown>[]> {
  return runOverpass(request);
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
  error?: { message?: string; status?: string };
}

function component(place: GooglePlace, type: string): string | null {
  const found = place.addressComponents?.find((item) => item.types?.includes(type));
  return found?.longText?.trim() || null;
}

async function runGooglePlaces(request: DiscoveryRequest): Promise<Record<string, unknown>[]> {
  if (!env.googlePlaces.apiKey) {
    throw conflict("Google Places is not configured. Add GOOGLE_PLACES_API_KEY and restart the app.");
  }
  const labels = request.categories
    .map((key) => CATEGORY_OPTIONS.find((option) => option.key === key)?.label ?? key)
    .join(" or ");
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.googlePlaces.apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryTypeDisplayName,places.location,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: `${labels} in ${request.city}${request.country ? `, ${request.country}` : ""}`,
      maxResultCount: Math.min(20, Math.max(1, request.limit)),
    }),
  });
  const payload = (await response.json()) as GooglePlacesResponse;
  if (!response.ok) {
    throw conflict(payload.error?.message ?? `Google Places returned HTTP ${response.status}.`);
  }
  return (payload.places ?? [])
    .filter((place) => Boolean(place.displayName?.text))
    .map((place) => ({
      name: place.displayName?.text ?? "",
      category: place.primaryTypeDisplayName?.text ?? "other",
      website: place.websiteUri ?? null,
      phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
      email: null,
      street: component(place, "street_number")
        ? `${component(place, "street_number")} ${component(place, "route") ?? ""}`.trim()
        : null,
      area: component(place, "sublocality_level_1") ?? component(place, "administrative_area_level_2"),
      city: component(place, "locality") ?? request.city,
      country: component(place, "country") ?? request.country,
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      sourceId: `google_places:${place.id ?? place.displayName?.text}`,
    }));
}

export interface DiscoveryResult {
  provider: DiscoveryProvider;
  found: number;
  importJobId: string | null;
  counts: IngestCounts | null;
  sample: Array<{
    name: string;
    city: string | null;
    website: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  /** Every result that carried coordinates, capped for the map preview. */
  mapped: Array<{ name: string; lat: number; lng: number }>;
  message: string;
}

const DISCOVERY_MAPPING: ColumnMapping = {
  name: "name",
  category: "category",
  website: "website",
  phone: "phone",
  email: "email",
  street: "street",
  area: "area",
  city: "city",
  country: "country",
  lat: "lat",
  lng: "lng",
  sourceId: "sourceId",
};

export async function runDiscovery(
  ctx: WorkspaceContext,
  request: DiscoveryRequest,
): Promise<DiscoveryResult> {
  const records =
    request.provider === "osm" ? await searchOsmRecords(request) : await runGooglePlaces(request);

  if (!records.length) {
    return {
      provider: request.provider,
      found: 0,
      importJobId: null,
      counts: null,
      sample: [],
      mapped: [],
      message:
        "No businesses matched this search. Check the city spelling or widen the categories. Nothing was saved.",
    };
  }

  const filename = `Discovery — ${request.city} (${request.provider === "osm" ? "OpenStreetMap" : "Google Places"})`;
  const [job] = await db
    .insert(importJobs)
    .values({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.user.id,
      origin: "discovery",
      filename: filename.slice(0, 240),
      fileHash: hashText(JSON.stringify(request)),
      mapping: DISCOVERY_MAPPING,
      detectedColumns: Object.keys(records[0] ?? {}),
      mappingConfirmed: true,
      status: "queued",
      rowCount: records.length,
    })
    .returning({ id: importJobs.id });
  if (!job) throw new Error("Could not create the discovery import.");

  async function* generate() {
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!record) continue;
      yield { rowNumber: index + 1, sourceFile: filename, record, raw: record };
    }
  }

  try {
    const counts = await ingestRecords({
      actor: { workspaceId: ctx.workspaceId, userId: ctx.user.id, isDemo: ctx.isDemo },
      jobId: job.id,
      source: request.provider === "osm" ? "osm" : "google_places",
      sourceLabel: filename,
      mapping: DISCOVERY_MAPPING,
      fallbackPrefix: request.provider,
      records: generate(),
      totalHint: records.length,
      onProgress: async (_counts, processed) => {
        await db
          .update(importJobs)
          .set({
            processedRows: processed,
            progress: Math.min(99, Math.round((processed / records.length) * 100)),
          })
          .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, job.id)));
      },
    });
    await finalizeImportJob(
      { workspaceId: ctx.workspaceId, userId: ctx.user.id, isDemo: ctx.isDemo },
      job.id,
      counts,
    );
    return {
      provider: request.provider,
      found: records.length,
      importJobId: job.id,
      counts,
      sample: records.slice(0, 12).map((record) => ({
        name: String(record.name ?? ""),
        city: record.city ? String(record.city) : null,
        website: record.website ? String(record.website) : null,
        lat: typeof record.lat === "number" ? record.lat : null,
        lng: typeof record.lng === "number" ? record.lng : null,
      })),
      mapped: records
        .filter(
          (record): record is Record<string, unknown> & { lat: number; lng: number } =>
            typeof record.lat === "number" && typeof record.lng === "number",
        )
        .slice(0, 200)
        .map((record) => ({ name: String(record.name ?? ""), lat: record.lat, lng: record.lng })),
      message: `Found ${records.length} businesses. ${counts.newCount} new, ${counts.mergedCount} merged, ${counts.reviewCount} sent to duplicate review.`,
    };
  } catch (error) {
    logger.error({ err: error, provider: request.provider }, "Discovery import failed");
    await db
      .update(importJobs)
      .set({
        status: "failed",
        progress: 100,
        error: error instanceof Error ? error.message.slice(0, 2000) : "Discovery ingest failed.",
        finishedAt: new Date(),
      })
      .where(and(eq(importJobs.workspaceId, ctx.workspaceId), eq(importJobs.id, job.id)));
    throw error;
  }
}

export interface SavedSearch {
  id: string;
  provider: string;
  country: string;
  city: string;
  categories: string[];
  limitCount: number;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export async function listSavedSearches(ctx: WorkspaceContext): Promise<SavedSearch[]> {
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.workspaceId, ctx.workspaceId))
    .orderBy(desc(savedSearches.createdAt));
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    country: row.country,
    city: row.city,
    categories: row.categories,
    limitCount: row.limitCount,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createSavedSearch(
  ctx: WorkspaceContext,
  request: DiscoveryRequest & { enabled?: boolean },
): Promise<SavedSearch> {
  const [row] = await db
    .insert(savedSearches)
    .values({
      workspaceId: ctx.workspaceId,
      provider: request.provider,
      country: request.country,
      city: request.city,
      categories: request.categories,
      limitCount: request.limit,
      enabled: Boolean(request.enabled),
    })
    .returning();
  if (!row) throw new Error("Could not save this search.");
  return {
    id: row.id,
    provider: row.provider,
    country: row.country,
    city: row.city,
    categories: row.categories,
    limitCount: row.limitCount,
    enabled: row.enabled,
    lastRunAt: null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteSavedSearch(ctx: WorkspaceContext, id: string): Promise<void> {
  const deleted = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.workspaceId, ctx.workspaceId), eq(savedSearches.id, id)))
    .returning({ id: savedSearches.id });
  if (!deleted.length) throw notFound("Saved search not found.");
}

export async function markSavedSearchRun(ctx: WorkspaceContext, id: string): Promise<void> {
  await db
    .update(savedSearches)
    .set({ lastRunAt: new Date() })
    .where(and(eq(savedSearches.workspaceId, ctx.workspaceId), eq(savedSearches.id, id)));
}
