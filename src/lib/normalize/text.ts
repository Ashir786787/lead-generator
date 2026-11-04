const LEGAL_SUFFIXES = [
  "llc",
  "l l c",
  "ltd",
  "limited",
  "pvt",
  "private",
  "pte",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "sarl",
  "sas",
  "bv",
  "nv",
  "ag",
  "sa",
  "srl",
  "fze",
  "fzco",
  "fz llc",
  "llp",
  "plc",
  "est",
  "establishment",
];

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeArabic(value: string): string {
  return value
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/**
 * Comparison-safe business name. The display name is never altered — this is
 * used only for matching and search.
 */
export function normalizeName(value: string): string {
  if (!value) return "";
  let result = normalizeArabic(stripDiacritics(value)).toLowerCase();
  result = result.replace(/&/g, " and ");
  result = result.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  result = result.replace(/\s+/g, " ");
  if (result.startsWith("the ")) result = result.slice(4);

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (result.endsWith(` ${suffix}`)) {
        result = result.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return result.trim();
}

export function normalizeCity(value: string): string {
  const cleaned = stripDiacritics(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const aliases: Record<string, string> = {
    dxb: "dubai",
    "abu dhabi city": "abu dhabi",
    "al ain": "al ain",
    "karāchi": "karachi",
    "islamabad capital territory": "islamabad",
    "london city": "london",
    "new york city": "new york",
    nyc: "new york",
  };
  return aliases[cleaned] ?? cleaned;
}

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const base = jaro(a, b);
  if (base < 0.7) return base;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefix++;
  }
  return base + prefix * prefixScale * (1 - base);
}

function tokenSet(a: string, b: string): number {
  const setA = [...new Set(a.split(" ").filter(Boolean))];
  const setB = [...new Set(b.split(" ").filter(Boolean))];
  if (!setA.length || !setB.length) return 0;
  const setBLookup = new Set(setB);
  const intersection = setA.filter((token) => setBLookup.has(token));
  if (!intersection.length) return 0;
  const restA = setA.filter((token) => !setBLookup.has(token));
  const restB = setB.filter((token) => !setA.includes(token));
  const joinedIntersection = intersection.join(" ");
  const candidates = [
    jaroWinkler(joinedIntersection, [...intersection, ...restA].join(" ")),
    jaroWinkler(joinedIntersection, [...intersection, ...restB].join(" ")),
    jaroWinkler(
      joinedIntersection,
      [...new Set([...intersection, ...restA, ...restB])].join(" "),
    ),
  ];
  return Math.max(...candidates);
}

/** Combined similarity used by dedupe (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return Math.max(jaroWinkler(left, right), tokenSet(left, right));
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
