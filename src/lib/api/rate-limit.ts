import { ApiError } from "@/lib/api/errors";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Small in-process fixed-window limiter. Sufficient for the single-instance v1
 * deployment; a shared store (Redis/Postgres) is documented as a follow-up.
 */
export function checkRateLimit(key: string, limit = 60, windowMs = 60_000): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  if (bucket.count >= limit) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and retry.", {
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    });
  }
  bucket.count += 1;
}
