const TRACKING_PARAMS = [
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "dclid",
  "twclid",
  "_ga",
];

const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.ae",
  "com.ae",
  "org.ae",
  "com.pk",
  "org.pk",
  "net.pk",
  "co.in",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.sa",
  "com.tr",
  "com.br",
  "co.jp",
]);

export interface NormalizedWebsite {
  /** Display URL, credentials removed, tracking params stripped. */
  url: string;
  /** Lower-case host without trailing dot, including www when present. */
  host: string;
  /** Host used for comparisons (www removed). */
  comparisonHost: string;
  /** eTLD+1 (best effort without a full public suffix list). */
  registrableHost: string;
  scheme: "http" | "https";
}

export function normalizeWebsite(input: string | null | undefined): NormalizedWebsite | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || !host.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;

  url.protocol = `${scheme}:`;
  url.hostname = host;
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  if (url.pathname === "/" && !url.search) {
    // keep root URL clean: https://example.com
  }

  const comparisonHost = host.replace(/^www\./, "");
  return {
    url: url.toString().replace(/\/$/, ""),
    host,
    comparisonHost,
    registrableHost: registrableHost(comparisonHost),
    scheme: scheme as "http" | "https",
  };
}

export function registrableHost(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeWebsite(a);
  const right = normalizeWebsite(b);
  if (!left || !right) return false;
  return left.registrableHost === right.registrableHost;
}
