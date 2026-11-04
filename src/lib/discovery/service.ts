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

async function runOverpass(request: DiscoveryRequest): Promise<Record<string, unknown>[]> {
  const query = buildOverpassQuery(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(env.overpass.endpoint, {
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
      throw conflict(`OpenStreetMap returned HTTP ${response.status}. Try a smaller search or retry shortly.`);
    }
    const payload = (await response.json()) as OverpassResponse;
    const elements = payload.elements ?? [];
    const records: Record<string, unknown>[] = [];
    for (const element of elements) {
      const tags = element.tags ?? {};
      const name = tags.name?.trim();
      if (!name) continue;
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || tags["addr:full"] || null;
      records.push({
        name,
        category: tags.cuisine ?? tags.amenity ?? tags.shop ?? tags.office ?? tags.tourism ?? tags.leisure ?? "other",
        website: tags.website ?? tags["contact:website"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        email: tags.email ?? tags["contact:email"] ?? null,
        street,
        area: tags["addr:suburb"] ?? tags["addr:district"] ?? null,
        city: tags["addr:city"] ?? request.city,
        country: tags["addr:country"] ?? request.country,
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lon === "number" ? lon : null,
        sourceId: `osm:${element.type}/${element.id}`,
      });
    }
    return records;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw conflict("OpenStreetMap took too long to respond. Try a smaller city or retry later.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  sample: Array<{ name: string; city: string | null; website: string | null }>;
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
    request.provider === "osm" ? await runOverpass(request) : await runGooglePlaces(request);

  if (!records.length) {
    return {
      provider: request.provider,
      found: 0,
      importJobId: null,
      counts: null,
      sample: [],
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
      sample: records.slice(0, 10).map((record) => ({
        name: String(record.name ?? ""),
        city: record.city ? String(record.city) : null,
        website: record.website ? String(record.website) : null,
      })),
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
