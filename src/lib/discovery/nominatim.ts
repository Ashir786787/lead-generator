import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { awaitNominatimSlot, type GeocodeBounds } from "@/lib/discovery/geocode";
import type { CategoryKey } from "@/lib/score/types";
import type { DiscoveryRequest } from "@/lib/discovery/service";

/**
 * Free, keyless OpenStreetMap discovery through the Nominatim POI index.
 *
 * The public Overpass API is frequently overloaded (20–50 s, 502/504). This
 * module reads the same OpenStreetMap data, answers in about a second and is
 * rate-limited by its usage policy to one request per second. Tag queries such
 * as `[amenity=dentist]` are exact and bounded to the geocoded city box, so a
 * normal search needs one request per category. Results carry the same
 * `osm:<type>/<id>` source id as Overpass, so dedupe keeps working.
 */

/** Exact OSM tag searches, tried first when the city bounds are known. */
const TAG_QUERIES: Record<CategoryKey, string[]> = {
  restaurant: ["[amenity=restaurant]", "[amenity=fast_food]"],
  cafe: ["[amenity=cafe]"],
  clinic: ["[amenity=clinic]", "[amenity=doctors]", "[amenity=hospital]", "[healthcare=clinic]"],
  dentist: ["[amenity=dentist]", "[healthcare=dentist]"],
  salon: ["[shop=hairdresser]", "[shop=beauty]"],
  spa: ["[leisure=spa]", "[shop=massage]", "[amenity=spa]"],
  gym: ["[leisure=fitness_centre]", "[leisure=sports_centre]", "[leisure=gym]"],
  hotel: ["[tourism=hotel]", "[tourism=guest_house]", "[tourism=hostel]"],
  real_estate: ["[office=estate_agent]", "[shop=estate_agent]"],
  law_firm: ["[office=lawyer]"],
  accounting: ["[office=accountant]", "[office=tax_advisor]"],
  education: ["[amenity=school]", "[amenity=college]", "[amenity=university]", "[amenity=language_school]"],
  ecommerce: [],
  retail: [],
  automotive: ["[shop=car_repair]", "[shop=car]", "[shop=tyres]"],
  construction: ["[craft=builder]", "[office=construction_company]"],
  travel: ["[shop=travel_agency]", "[office=travel_agent]"],
  other: [],
};

/** Free-text fallback for categories without a reliable OSM tag. */
const KEYWORDS: Record<CategoryKey, string> = {
  restaurant: "restaurant",
  cafe: "cafe",
  clinic: "clinic",
  dentist: "dentist",
  salon: "hairdresser",
  spa: "spa",
  gym: "gym",
  hotel: "hotel",
  real_estate: "estate agent",
  law_firm: "lawyer",
  accounting: "accountant",
  education: "school",
  ecommerce: "copy shop",
  retail: "store",
  automotive: "car repair",
  construction: "builder",
  travel: "travel agency",
  other: "",
};

/** Nominatim classes that represent a business/venue rather than a boundary. */
const POI_CLASSES = new Set(["amenity", "shop", "office", "tourism", "leisure", "healthcare", "craft"]);

const placeSchema = z.object({
  osm_type: z.enum(["node", "way", "relation"]).nullish(),
  osm_id: z.number().nullish(),
  lat: z.string(),
  lon: z.string(),
  category: z.string().nullish(),
  type: z.string().nullish(),
  name: z.string().nullish(),
  display_name: z.string(),
  address: z.record(z.string(), z.string()).nullish(),
  extratags: z.record(z.string(), z.string()).nullish(),
});

type NominatimPlace = z.infer<typeof placeSchema>;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstAddress(address: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(address[key]);
    if (value) return value;
  }
  return null;
}

function toRecord(place: NominatimPlace): Record<string, unknown> | null {
  if (place.category && !POI_CLASSES.has(place.category)) return null;
  // A lead needs a real business name; unnamed POIs are not useful leads.
  const name = clean(place.name);
  if (!name) return null;
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!place.osm_type || typeof place.osm_id !== "number") return null;
  const address = place.address ?? {};
  const extratags = place.extratags ?? {};
  const street =
    [clean(address.house_number), clean(address.road)].filter(Boolean).join(" ") || null;
  return {
    name,
    category: clean(place.type) ?? clean(place.category) ?? "other",
    website:
      clean(extratags.website) ?? clean(extratags["contact:website"]) ?? clean(extratags.url) ?? null,
    phone: clean(extratags.phone) ?? clean(extratags["contact:phone"]) ?? null,
    email: clean(extratags.email) ?? clean(extratags["contact:email"]) ?? null,
    street,
    area:
      firstAddress(address, ["suburb", "neighbourhood", "city_district", "district"]) ?? null,
    city:
      firstAddress(address, ["city", "town", "village", "municipality", "county"]) ?? null,
    country: firstAddress(address, ["country"]) ?? null,
    lat,
    lng: lon,
    // Same scheme as Overpass so the dedupe pipeline recognises the same venue.
    sourceId: `osm:${place.osm_type}/${place.osm_id}`,
  };
}

const placeCache = new Map<string, { expiresAt: number; records: Record<string, unknown>[] }>();
const PLACE_CACHE_LIMIT = 120;

export function clearNominatimPlaceCache(): void {
  placeCache.clear();
}

export interface NominatimSearchOutcome {
  records: Record<string, unknown>[];
  /** True when every request failed, as opposed to succeeding with no matches. */
  failed: boolean;
  note: string | null;
}

interface QueryResult {
  ok: boolean;
  records: Record<string, unknown>[];
  error: string | null;
}

function hasQueries(category: CategoryKey, bounds: GeocodeBounds | null): boolean {
  return Boolean(KEYWORDS[category]) || Boolean(bounds && TAG_QUERIES[category].length);
}

async function queryPlaces(query: string, limit: number, bounds: GeocodeBounds | null): Promise<QueryResult> {
  const url = new URL(env.geocode.endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", "en");
  if (bounds) {
    url.searchParams.set(
      "viewbox",
      `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`,
    );
    url.searchParams.set("bounded", "1");
  }

  await awaitNominatimSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": env.geocode.userAgent },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, records: [], error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body) && "error" in body) {
      const rawError = (body as { error: unknown }).error;
      const message =
        typeof rawError === "string"
          ? rawError
          : typeof rawError === "object" && rawError && "message" in rawError
            ? String((rawError as { message: unknown }).message)
            : "search error";
      if (/unable to geocode|no result|not found/i.test(message)) {
        // Nominatim answers "Unable to geocode" when nothing matches; that is
        // an empty result, not an outage.
        return { ok: true, records: [], error: null };
      }
      return { ok: false, records: [], error: message.slice(0, 120) };
    }
    const parsed = z.array(placeSchema).safeParse(body);
    if (!parsed.success) {
      return { ok: false, records: [], error: "unexpected response" };
    }
    const records: Record<string, unknown>[] = [];
    for (const place of parsed.data) {
      const record = toRecord(place);
      if (record) records.push(record);
    }
    return { ok: true, records, error: null };
  } catch (error) {
    return {
      ok: false,
      records: [],
      error: error instanceof Error && error.name === "AbortError" ? "timed out" : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchNominatimPlaces(
  request: DiscoveryRequest,
  bounds: GeocodeBounds | null,
): Promise<NominatimSearchOutcome> {
  const categories = request.categories.filter((category) => hasQueries(category, bounds));
  if (!categories.length) {
    return { records: [], failed: false, note: "No categories can be searched through the OSM POI index." };
  }

  const perCategoryLimit = Math.min(40, Math.max(1, request.limit));
  const collected: Record<string, unknown>[] = [];
  const failures: string[] = [];
  let succeeded = 0;

  for (const category of categories) {
    const cacheKey = [
      request.city.trim().toLowerCase(),
      request.country.trim().toLowerCase(),
      category,
      perCategoryLimit,
      bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : "global",
    ].join("|");
    const cached = placeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      collected.push(...cached.records.map((record) => ({ ...record })));
      succeeded += 1;
      continue;
    }

    const categoryRecords: Record<string, unknown>[] = [];
    let categorySucceeded = false;
    let lastError: string | null = null;

    const tagQueries = bounds ? TAG_QUERIES[category] : [];
    for (const query of tagQueries) {
      if (categoryRecords.length >= perCategoryLimit) break;
      const result = await queryPlaces(query, perCategoryLimit - categoryRecords.length, bounds);
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      categorySucceeded = true;
      categoryRecords.push(...result.records);
    }

    // Free-text search is only a fallback when the exact tag queries found
    // nothing; otherwise it would add a slower, less precise extra request.
    if (!categoryRecords.length) {
      const keyword = KEYWORDS[category];
      const query = bounds
        ? keyword
        : `${keyword} ${request.city}${request.country ? `, ${request.country}` : ""}`.trim();
      if (keyword) {
        const result = await queryPlaces(query, perCategoryLimit, bounds);
        if (!result.ok) {
          lastError = result.error;
        } else {
          categorySucceeded = true;
          categoryRecords.push(...result.records);
        }
      }
    }

    if (!categorySucceeded) {
      if (lastError) failures.push(`${category}: ${lastError}`);
      continue;
    }

    succeeded += 1;
    const limited = categoryRecords.slice(0, perCategoryLimit);
    if (placeCache.size >= PLACE_CACHE_LIMIT) {
      const oldest = placeCache.keys().next().value;
      if (oldest) placeCache.delete(oldest);
    }
    placeCache.set(cacheKey, {
      expiresAt: Date.now() + env.geocode.cacheMinutes * 60_000,
      records: limited.map((record) => ({ ...record })),
    });
    collected.push(...limited);
  }

  if (failures.length) {
    logger.warn({ failures }, "OSM POI index query failed");
  }

  // Stable de-duplication: the same venue can match more than one tag.
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const record of collected) {
    const sourceId = String(record.sourceId ?? "");
    if (sourceId && seen.has(sourceId)) continue;
    if (sourceId) seen.add(sourceId);
    unique.push({
      ...record,
      city: record.city ?? request.city,
      country: record.country ?? request.country,
    });
    if (unique.length >= request.limit) break;
  }

  return {
    records: unique,
    failed: succeeded === 0 && failures.length > 0,
    note: failures.length
      ? `Some OSM POI queries failed (${failures.slice(0, 3).join("; ")}).`
      : null,
  };
}
