import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Applies every pending SQL migration in src/lib/db/migrations.
 * Uses a dedicated advisory lock so two deploys cannot migrate concurrently.
 */
async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(918273645)");
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
    logger.info("Database migrations applied.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(918273645)").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
