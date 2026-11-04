import type { CategoryKey } from "@/lib/score/types";
import { CATEGORY_OPTIONS } from "@/lib/constants";

interface CategoryRule {
  key: CategoryKey;
  patterns: RegExp[];
}

const RULES: CategoryRule[] = [
  {
    key: "clinic",
    patterns: [/\bclinic\b/, /\bmedical\b/, /\bhealth\s?care\b/, /\bhospital\b/, /\bdoctor/, /\bphysician\b/],
  },
  { key: "dentist", patterns: [/\bdent/, /\boral\b/, /\borthodont/, /\btooth\b/] },
  { key: "salon", patterns: [/\bsalon\b/, /\bhair\b/, /\bbarber\b/, /\bbeaut/] },
  { key: "spa", patterns: [/\bspa\b/, /\bmassage\b/, /\bwellness\b/] },
  { key: "gym", patterns: [/\bgym\b/, /\bfitness\b/, /\byoga\b/, /\bpilates\b/, /\bcrossfit\b/] },
  { key: "restaurant", patterns: [/\brestaurant\b/, /\bbistro\b/, /\bgrill\b/, /\bdiner\b/, /\beatery\b/, /\bfast\s?food\b/, /\bpizza\b/, /\bsushi\b/, /\bburger\b/] },
  { key: "cafe", patterns: [/\bcaf[eé]\b/, /\bcoffee\b/, /\bbakery\b/, /\bpatisserie\b/, /\btea\b/] },
  { key: "hotel", patterns: [/\bhotel\b/, /\bresort\b/, /\bmotel\b/, /\bguest\s?house\b/, /\bhostel\b/, /\bserviced\s?apartment\b/] },
  {
    key: "real_estate",
    patterns: [/\breal\s?estate\b/, /\bproperty\b/, /\bpropert/, /\bestate\s?agent\b/, /\bletting\b/, /\brealtor\b/],
  },
  { key: "law_firm", patterns: [/\blaw\b/, /\blegal\b/, /\battorney\b/, /\bsolicitor\b/, /\badvocate/] },
  { key: "accounting", patterns: [/\baccount/, /\bbookkeep/, /\baudit/, /\btax\b/] },
  {
    key: "education",
    patterns: [/\bschool\b/, /\bacademy\b/, /\btraining\b/, /\bcollege\b/, /\buniversity\b/, /\btutor/, /\bnursery\b/],
  },
  { key: "ecommerce", patterns: [/\bonline\s?shop\b/, /\be-?commerce\b/, /\bstore\b/, /\bboutique\b/] },
  { key: "retail", patterns: [/\bshop\b/, /\bretail\b/, /\bmarket\b/, /\bsupermarket\b/, /\bgrocer/] },
  { key: "automotive", patterns: [/\bcar\b/, /\bauto\b/, /\bgarage\b/, /\bworkshop\b/, /\bdealership\b/] },
  { key: "construction", patterns: [/\bconstruction\b/, /\bcontractor\b/, /\bbuilder\b/, /\binterior\b/, /\barchitect/] },
  { key: "travel", patterns: [/\btravel\b/, /\btour\b/, /\bairline\b/, /\bticketing\b/] },
];

const OSM_TAG_MAP: Record<string, CategoryKey> = {
  restaurant: "restaurant",
  fast_food: "restaurant",
  cafe: "cafe",
  bar: "restaurant",
  pub: "restaurant",
  clinic: "clinic",
  doctors: "clinic",
  dentist: "dentist",
  hospital: "clinic",
  beauty: "salon",
  hairdresser: "salon",
  massage: "spa",
  spa: "spa",
  fitness_centre: "gym",
  gym: "gym",
  hotel: "hotel",
  guest_house: "hotel",
  estate_agent: "real_estate",
  lawyer: "law_firm",
  accountant: "accounting",
  school: "education",
  college: "education",
  driving_school: "education",
  car_repair: "automotive",
  car: "automotive",
  travel_agency: "travel",
  travel: "travel",
};

export interface CategoryMapping {
  key: CategoryKey;
  label: string;
}

export function mapCategory(
  raw: string | null | undefined,
  overrides?: Record<string, CategoryKey>,
): CategoryMapping {
  if (!raw) return { key: "other", label: "Other" };
  const value = raw.trim().toLowerCase();
  if (!value) return { key: "other", label: "Other" };

  if (overrides) {
    const direct = overrides[value];
    if (direct) return { key: direct, label: labelFor(direct) };
  }
  if (OSM_TAG_MAP[value]) return { key: OSM_TAG_MAP[value], label: labelFor(OSM_TAG_MAP[value]) };

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(value))) {
      return { key: rule.key, label: labelFor(rule.key) };
    }
  }
  return { key: "other", label: raw.trim().slice(0, 60) };
}

export function labelFor(key: CategoryKey): string {
  return CATEGORY_OPTIONS.find((option) => option.key === key)?.label ?? "Other";
}

/** OSM tag → category (used by live discovery). */
export function osmTagToCategory(tags: Record<string, string>): { key: CategoryKey; raw: string } {
  for (const [tag, value] of Object.entries(tags)) {
    if (tag === "amenity" || tag === "shop" || tag === "office" || tag === "tourism" || tag === "leisure" || tag === "craft" || tag === "healthcare") {
      if (OSM_TAG_MAP[value]) return { key: OSM_TAG_MAP[value], raw: `${tag}=${value}` };
    }
  }
  const direct = tags.cuisine ?? tags.shop ?? tags.amenity ?? tags.office ?? tags.tourism ?? "";
  return { key: mapCategory(direct).key, raw: direct || "other" };
}
