import "dotenv/config";
import { closeMongo, connectMongo } from "@/lib/db";
import { ensureIndexes } from "@/lib/db/indexes";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

function maskedUri(uri: string): string {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

/**
 * Drops the configured MongoDB database and recreates the indexes. Destructive
 * by design, so it refuses to run unless:
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
        `  ${maskedUri(env.mongoUri)} (database: ${env.mongoDbName})`,
        "",
        "Re-run with:  pnpm db:reset --yes",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  if (env.isProduction) {
    console.error("Refusing to reset the database while NODE_ENV=production.");
    process.exitCode = 1;
    return;
  }

  const db = await connectMongo();
  try {
    await db.dropDatabase();
    logger.warn({ database: env.mongoDbName }, "Database dropped.");
    await ensureIndexes(db);
    logger.info({ database: env.mongoDbName }, "Database reset and indexes recreated.");
  } finally {
    await closeMongo();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
