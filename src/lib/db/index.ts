import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __leadFinderPool?: Pool;
};

export const pool =
  globalForDb.__leadFinderPool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: env.isTest ? 5 : 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (!env.isProduction) {
  globalForDb.__leadFinderPool = pool;
}

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export { schema };
