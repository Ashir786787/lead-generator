import type { RawBusiness } from "@/lib/normalize";

export const IMPORT_FIELDS = [
  "name",
  "category",
  "website",
  "phone",
  "email",
  "street",
  "area",
  "city",
  "country",
  "lat",
  "lng",
  "sourceId",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, string>>;

const SYNONYMS: Record<ImportField, string[]> = {
  name: ["name", "business name", "business", "company", "company name", "title", "place name", "brand", "organisation", "organization", "اسم", "نام"],
  category: ["category", "categories", "type", "industry", "sector", "primary category", "subcategory", "cuisine", "amenity", "shop", "office", "tags", "فئة"],
  website: ["website", "url", "site", "web", "homepage", "website url", "domain", "web url"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "contact phone", "international phone", "phone_numbers", "phones", "هاتف"],
  email: ["email", "e-mail", "mail", "contact email", "emails", "email address", "بريد"],
  street: ["street", "address", "street address", "address line 1", "addr:street", "line1", "full address"],
  area: ["area", "neighbourhood", "neighborhood", "district", "suburb", "locality", "addr:district"],
  city: ["city", "town", "municipality", "addr:city", "مدينة"],
  country: ["country", "country code", "addr:country", "nation", "بلد"],
  lat: ["lat", "latitude", "y", "geo lat", "lat (wgs84)", "addr:lat"],
  lng: ["lng", "lon", "long", "longitude", "x", "geo lng", "addr:lon"],
  sourceId: ["id", "source id", "place id", "osm id", "overture id", "external id", "gid", "record id"],
};

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function guessMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalised = columns.map((column) => ({ original: column, key: normaliseHeader(column) }));

  for (const field of IMPORT_FIELDS) {
    const candidates = SYNONYMS[field];
    const exact = normalised.find((column) => candidates.includes(column.key));
    if (exact) {
      mapping[field] = exact.original;
      continue;
    }
    const partial = normalised.find((column) =>
      candidates.some((candidate) => column.key === candidate || column.key.startsWith(`${candidate} `) || column.key.endsWith(` ${candidate}`)),
    );
    if (partial) mapping[field] = partial.original;
  }
  return mapping;
}

export function applyMapping(
  record: Record<string, unknown>,
  mapping: ColumnMapping,
): RawBusiness {
  const pick = (field: ImportField): string | null => {
    const column = mapping[field];
    if (!column) return null;
    const value = record[column];
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  };
  const latRaw = pick("lat");
  const lngRaw = pick("lng");
  const lat = latRaw !== null ? Number(latRaw) : null;
  const lng = lngRaw !== null ? Number(lngRaw) : null;
  return {
    name: pick("name") ?? "",
    category: pick("category"),
    website: pick("website"),
    phone: pick("phone"),
    email: pick("email"),
    street: pick("street"),
    area: pick("area"),
    city: pick("city"),
    country: pick("country"),
    lat: lat !== null && Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lng: lng !== null && Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
    sourceId: pick("sourceId"),
  };
}

export function mappingWarnings(mapping: ColumnMapping): string[] {
  const warnings: string[] = [];
  if (!mapping.name) warnings.push("No name column detected — pick the column that holds the business name.");
  if (!mapping.city && !mapping.lat) warnings.push("No city or coordinates mapped; filtering by city will be limited.");
  if (!mapping.website) warnings.push("No website column mapped; website scanning will be unavailable for these leads.");
  return warnings;
}
