import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type PhoneKind = "mobile" | "fixed_line" | "unknown";

export interface NormalizedPhone {
  e164: string | null;
  kind: PhoneKind;
  country: string | null;
  valid: boolean;
  raw: string;
}

const COUNTRY_NAMES: Record<string, CountryCode> = {
  uae: "AE",
  "united arab emirates": "AE",
  emirates: "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  sharjah: "AE",
  pakistan: "PK",
  karachi: "PK",
  lahore: "PK",
  islamabad: "PK",
  uk: "GB",
  "united kingdom": "GB",
  england: "GB",
  london: "GB",
  us: "US",
  usa: "US",
  "united states": "US",
  india: "IN",
  saudi: "SA",
  "saudi arabia": "SA",
  qatar: "QA",
  kuwait: "KW",
  oman: "OM",
  bahrain: "BH",
  germany: "DE",
  france: "FR",
  canada: "CA",
  australia: "AU",
  turkey: "TR",
  egypt: "EG",
};

export function countryToCode(value: string | null | undefined): CountryCode | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  if (COUNTRY_NAMES[key]) return COUNTRY_NAMES[key];
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase() as CountryCode;
  return undefined;
}

export function normalizePhone(
  value: string | null | undefined,
  defaultCountry?: string | null,
): NormalizedPhone | null {
  if (!value) return null;
  let raw = value
    .replace(/^tel:/i, "")
    .replace(/^whatsapp:/i, "")
    .replace(/[\u200e\u200f\u00a0]/g, " ")
    .trim();
  if (!raw) return null;
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  raw = raw.replace(/[^\d+()\-.\s]/g, "").trim();
  if (!raw) return null;

  const region = countryToCode(defaultCountry);
  let phone;
  try {
    phone = parsePhoneNumberFromString(raw, region);
  } catch {
    phone = undefined;
  }
  if (!phone) {
    return { e164: null, kind: "unknown", country: region ?? null, valid: false, raw: value };
  }
  const type = phone.getType();
  const kind: PhoneKind =
    type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE"
      ? "mobile"
      : type === "FIXED_LINE"
        ? "fixed_line"
        : "unknown";
  return {
    e164: phone.number,
    kind,
    country: phone.country ?? region ?? null,
    valid: phone.isValid(),
    raw: value,
  };
}
