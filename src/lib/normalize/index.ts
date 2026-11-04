import { normalizeName, normalizeCity } from "./text";
import { normalizeWebsite, type NormalizedWebsite } from "./website";
import { normalizePhone, type NormalizedPhone } from "./phone";
import { normalizeEmail } from "./email";
import { mapCategory, type CategoryMapping } from "./category";

export * from "./text";
export * from "./website";
export * from "./phone";
export * from "./email";
export * from "./category";

export interface RawBusiness {
  name: string;
  category?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  area?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  sourceId?: string | null;
}

export interface NormalizedBusiness {
  name: string;
  normalizedName: string;
  category: string | null;
  categoryKey: string;
  city: string | null;
  cityNormalized: string | null;
  country: string | null;
  street: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  website: NormalizedWebsite | null;
  phone: NormalizedPhone | null;
  email: string | null;
  emailDisplay: string | null;
  categoryMapping: CategoryMapping;
}

export function normalizeBusiness(
  raw: RawBusiness,
  options?: { categoryOverrides?: Record<string, ReturnType<typeof mapCategory>["key"]> },
): NormalizedBusiness {
  const name = (raw.name ?? "").trim().replace(/\s+/g, " ");
  const categoryMapping = mapCategory(raw.category, options?.categoryOverrides);
  const emailRaw = raw.email?.trim() ?? null;
  return {
    name,
    normalizedName: normalizeName(name),
    category: raw.category?.trim() ?? null,
    categoryKey: categoryMapping.key,
    city: raw.city?.trim() ?? null,
    cityNormalized: raw.city ? normalizeCity(raw.city) : null,
    country: raw.country?.trim() ?? null,
    street: raw.street?.trim() ?? null,
    area: raw.area?.trim() ?? null,
    lat: typeof raw.lat === "number" && Number.isFinite(raw.lat) ? raw.lat : null,
    lng: typeof raw.lng === "number" && Number.isFinite(raw.lng) ? raw.lng : null,
    website: normalizeWebsite(raw.website),
    phone: normalizePhone(raw.phone, raw.country ?? undefined),
    email: normalizeEmail(emailRaw),
    emailDisplay: emailRaw,
    categoryMapping,
  };
}
