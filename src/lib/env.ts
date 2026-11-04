import "dotenv/config";

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Lead Finder",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://leadfinder:leadfinder@127.0.0.1:5433/leadfinder",
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET ?? "development-only-secret-change-me-0123456789abcdef",
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  allowSignup: bool(process.env.ALLOW_SIGNUP, false),
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "UTC",
  storageDir: process.env.STORAGE_DIR ?? ".data/storage",
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
  zip: {
    maxEntries: num(process.env.ZIP_MAX_ENTRIES, 200),
    maxTotalUncompressed: num(process.env.ZIP_MAX_TOTAL_UNCOMPRESSED, 200 * 1024 * 1024),
    maxEntryUncompressed: num(process.env.ZIP_MAX_ENTRY_UNCOMPRESSED, 50 * 1024 * 1024),
    maxCompressionRatio: num(process.env.ZIP_MAX_COMPRESSION_RATIO, 100),
  },
  scan: {
    userAgent:
      process.env.SCAN_USER_AGENT ?? "LeadFinderBot/1.0 (+https://example.com/bot)",
    maxPages: num(process.env.SCAN_MAX_PAGES, 4),
    cacheDays: num(process.env.SCAN_CACHE_DAYS, 7),
    connectTimeoutMs: num(process.env.SCAN_CONNECT_TIMEOUT_MS, 5000),
    totalTimeoutMs: num(process.env.SCAN_TOTAL_TIMEOUT_MS, 15000),
    maxBodyBytes: num(process.env.SCAN_MAX_BODY_BYTES, 2 * 1024 * 1024),
    globalConcurrency: num(process.env.SCAN_GLOBAL_CONCURRENCY, 5),
    perHostDelayMs: num(process.env.SCAN_PER_HOST_DELAY_MS, 1000),
    retries: num(process.env.SCAN_RETRIES, 2),
    allowPrivateTargetsForTests: bool(process.env.ALLOW_PRIVATE_TARGETS_FOR_TESTS, false),
  },
  overpass: {
    endpoint: process.env.OVERPASS_ENDPOINT ?? "https://overpass-api.de/api/interpreter",
    endpoints: list(process.env.OVERPASS_ENDPOINTS),
    cacheMinutes: num(process.env.OVERPASS_CACHE_MINUTES, 60),
    timeoutMs: num(process.env.OVERPASS_TIMEOUT_MS, 55_000),
    retries: num(process.env.OVERPASS_RETRIES, 2),
  },
  googlePlaces: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
    dailyBudget: num(process.env.GOOGLE_PLACES_DAILY_BUDGET, 100),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    // Model names churn quickly; the default is a currently available Flash model.
    model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
  },
  grok: {
    apiKey: process.env.GROK_API_KEY ?? "",
    model: process.env.GROK_MODEL ?? "grok-4",
    baseUrl: process.env.GROK_BASE_URL ?? "https://api.x.ai/v1",
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? "",
    model: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  },
  geocode: {
    endpoint: process.env.GEOCODE_ENDPOINT ?? "https://nominatim.openstreetmap.org/search",
    cacheMinutes: num(process.env.GEOCODE_CACHE_MINUTES, 1440),
    userAgent: process.env.GEOCODE_USER_AGENT ?? process.env.SCAN_USER_AGENT ?? "LeadFinderBot/1.0",
  },
  pgBossSchema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

/**
 * Hard safety guard: the scanner may only reach private hosts in tests.
 * Setting the test escape hatch in production is a fatal configuration error.
 */
export function assertSafeConfig(): void {
  if (env.isProduction && env.scan.allowPrivateTargetsForTests) {
    throw new Error(
      "ALLOW_PRIVATE_TARGETS_FOR_TESTS must never be enabled in production. Refusing to start.",
    );
  }
  if (env.isProduction && env.betterAuthSecret.includes("development-only")) {
    throw new Error("BETTER_AUTH_SECRET must be set to a strong random value in production.");
  }
}
