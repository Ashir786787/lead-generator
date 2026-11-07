import "dotenv/config";
import { closeMongo, connectMongo } from "@/lib/db";
import { ensureIndexes } from "@/lib/db/indexes";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Creates every MongoDB index the application relies on. Index creation is
 * idempotent, so this is safe to run on every deploy. Serverless requests never
 * run DDL themselves; they expect these indexes to exist already.
 */
async function main(): Promise<void> {
  const db = await connectMongo();
  try {
    await ensureIndexes(db);
    logger.info(
      { database: env.mongoDbName },
      "MongoDB indexes are up to date.",
    );
  } finally {
    await closeMongo();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
