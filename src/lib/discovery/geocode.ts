import { z } from "zod";
import { conflict } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface GeocodeBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeocodeResult {
  displayName: string;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  bounds: GeocodeBounds | null;
}

const nominatimSchema = z.array(
  z.object({
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
    boundingbox: z.array(z.string()).length(4).optional(),
    address: z
      .object({
        city: z.string().optional(),
        town: z.string().optional(),
        village: z.string().optional(),
        municipality: z.string().optional(),
        county: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        country_code: z.string().optional(),
      })
      .optional(),
  }),
);

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseGeocodeResults(payload: unknown): GeocodeResult[] {
  const parsed = nominatimSchema.safeParse(payload);
  if (!parsed.success) {
    throw conflict("The map service returned an unexpected response. Retry shortly.");
  }
  const results: GeocodeResult[] = [];
  for (const item of parsed.data) {
    const lat = toNumber(item.lat);
    const lng = toNumber(item.lon);
    if (lat === null || lng === null) continue;
    let bounds: GeocodeBounds | null = null;
    if (item.boundingbox) {
      const south = toNumber(item.boundingbox[0] ?? "");
      const north = toNumber(item.boundingbox[1] ?? "");
      const west = toNumber(item.boundingbox[2] ?? "");
      const east = toNumber(item.boundingbox[3] ?? "");
      if (south !== null && north !== null && west !== null && east !== null) {
        bounds = { south, west, north, east };
      }
    }
    const address = item.address ?? {};
    results.push({
      displayName: item.display_name,
      city:
        address.city ??
        address.town ??
        address.village ??
        address.municipality ??
        address.county ??
        null,
      country: address.country ?? null,
      lat,
      lng,
      bounds,
    });
  }
  return results.slice(0, 6);
}

interface GeocodeCacheEntry {
  expiresAt: number;
  results: GeocodeResult[];
}

const geocodeCache = new Map<string, GeocodeCacheEntry>();
const GEOCODE_CACHE_LIMIT = 200;
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNominatimSlot(): Promise<void> {
  // Nominatim's usage policy asks for at most one request per second.
  const minimumInterval = env.isTest ? 0 : 1100;
  const wait = lastRequestAt + minimumInterval - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export function clearGeocodeCache(): void {
  geocodeCache.clear();
}

export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim().slice(0, 220);
  if (trimmed.length < 2) return [];
  const cacheKey = trimmed.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results.map((result) => ({ ...result, bounds: result.bounds ? { ...result.bounds } : null }));
  }

  await waitForNominatimSlot();
  const url = new URL(env.geocode.endpoint);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "en");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": env.geocode.userAgent,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw conflict(
        `The OpenStreetMap geocoder returned HTTP ${response.status}. Retry shortly or enter the city manually.`,
      );
    }
    const results = parseGeocodeResults((await response.json()) as unknown);
    if (geocodeCache.size >= GEOCODE_CACHE_LIMIT) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest) geocodeCache.delete(oldest);
    }
    geocodeCache.set(cacheKey, {
      expiresAt: Date.now() + env.geocode.cacheMinutes * 60_000,
      results,
    });
    logger.info({ query: trimmed, results: results.length }, "Geocoded search area");
    return results;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw conflict("The OpenStreetMap geocoder took too long to respond. Retry shortly.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
