import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Drops and rebuilds the schema of the configured database, then re-applies the
 * migrations. Destructive by design, so it refuses to run unless:
 *   - NODE_ENV is not "production", and
 *   - the caller passes --yes (or sets RESET_DB_CONFIRM=yes).
 *
 * Usage:
 *   pnpm db:reset --yes
 */
async function main(): Promise<void> {
  const confirmed = process.argv.includes("--yes") || process.env.RESET_DB_CONFIRM === "yes";
  if (!confirmed) {
    console.error(
      [
        "Refusing to reset the database without confirmation.",
        "This permanently deletes every workspace, lead, scan and import in:",
        `  ${env.databaseUrl.replace(/:[^:@/]+@/, ":***@")}`,
        "",
        "Re-run with:  pnpm db:reset --yes",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  if (env.isProduction) {
    console.error("Refusing to reset a production database.");
    process.exitCode = 1;
    return;
  }

  logger.warn({ database: env.databaseUrl.replace(/:[^:@/]+@/, ":***@") }, "Resetting database schema");

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(918273645)");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
    logger.info("Database reset and migrations applied.");
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
