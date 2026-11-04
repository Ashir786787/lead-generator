import { haversineMeters, nameSimilarity, normalizeName } from "@/lib/normalize/text";
import { registrableHost } from "@/lib/normalize/website";

export interface DedupeRecord {
  name: string;
  phoneE164: string | null;
  websiteHost: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;
}

export type DedupeAction = "merge" | "review" | "none";

export interface DedupeDecision {
  action: DedupeAction;
  reason: string;
  similarity: number;
  distanceM: number | null;
}

export const DEDUPE_THRESHOLDS = {
  phoneNameMerge: 0.85,
  hostNameMerge: 0.8,
  hostDistanceMergeM: 150,
  nameReview: 0.85,
  nameReviewDistanceM: 100,
} as const;

function streetKey(value: string | null): string {
  return value ? normalizeName(value) : "";
}

function distance(a: DedupeRecord, b: DedupeRecord): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  return haversineMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}

/**
 * Deterministic duplicate policy. Shared domain cannot merge branches on its own:
 * a matching host only merges with supporting name + location evidence.
 */
export function decideDuplicate(a: DedupeRecord, b: DedupeRecord): DedupeDecision {
  const similarity = nameSimilarity(a.name, b.name);
  const distanceM = distance(a, b);
  const samePhone = Boolean(a.phoneE164 && b.phoneE164 && a.phoneE164 === b.phoneE164);
  const hostA = a.websiteHost ? registrableHost(a.websiteHost.replace(/^www\./, "")) : null;
  const hostB = b.websiteHost ? registrableHost(b.websiteHost.replace(/^www\./, "")) : null;
  const sameHost = Boolean(hostA && hostB && hostA === hostB);
  const sameStreet =
    Boolean(streetKey(a.street)) && streetKey(a.street) === streetKey(b.street);

  if (samePhone && similarity >= DEDUPE_THRESHOLDS.phoneNameMerge) {
    return {
      action: "merge",
      reason: "Same phone number and very similar name",
      similarity,
      distanceM,
    };
  }
  if (
    sameHost &&
    similarity >= DEDUPE_THRESHOLDS.hostNameMerge &&
    (sameStreet || (distanceM !== null && distanceM <= DEDUPE_THRESHOLDS.hostDistanceMergeM))
  ) {
    return {
      action: "merge",
      reason: sameStreet
        ? "Same website domain, similar name and same street"
        : "Same website domain, similar name and within 150 m",
      similarity,
      distanceM,
    };
  }
  if (
    similarity >= DEDUPE_THRESHOLDS.nameReview &&
    distanceM !== null &&
    distanceM <= DEDUPE_THRESHOLDS.nameReviewDistanceM
  ) {
    return {
      action: "review",
      reason: "Very similar name and within 100 m, but no shared phone or domain",
      similarity,
      distanceM,
    };
  }
  if (samePhone) {
    return {
      action: "review",
      reason: "Same phone number but the names differ",
      similarity,
      distanceM,
    };
  }
  return { action: "none", reason: "No duplicate signals", similarity, distanceM };
}
