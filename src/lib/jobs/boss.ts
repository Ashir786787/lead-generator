import { PgBoss, type Job, type SendOptions } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const JOB_NAMES = {
  healthcheck: "healthcheck",
  importProcess: "import.process",
  scanBusiness: "scan.business",
  exportGenerate: "export.generate",
  scoreRecalculate: "score.recalculate",
  discoveryIngest: "discovery.ingest",
} as const;

export interface JobPayloadMap {
  [JOB_NAMES.healthcheck]: { workspaceId?: string };
  [JOB_NAMES.importProcess]: { workspaceId: string; importJobId: string };
  [JOB_NAMES.scanBusiness]: { workspaceId: string; businessId: string; scanJobId: string; force?: boolean };
  [JOB_NAMES.exportGenerate]: { workspaceId: string; exportJobId: string };
  [JOB_NAMES.scoreRecalculate]: { workspaceId: string; requestedBy: string };
  [JOB_NAMES.discoveryIngest]: { workspaceId: string; importJobId: string };
}

export type JobHandler<K extends keyof JobPayloadMap> = (jobs: Job<JobPayloadMap[K]>[]) => Promise<void>;

const globalForBoss = globalThis as unknown as { __leadFinderBoss?: Promise<PgBoss> };

async function startBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env.databaseUrl,
    schema: env.pgBossSchema,
    max: env.isTest ? 4 : 8,
    application_name: "lead-finder",
  });
  boss.on("error", (error: Error) => logger.error({ err: error }, "pg-boss error"));
  boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));

  await boss.start();
  // pg-boss 12 requires an explicit createQueue() before send()/work();
  // queues are not created on demand. createQueue is idempotent.
  await Promise.all(Object.values(JOB_NAMES).map((name) => boss.createQueue(name)));
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__leadFinderBoss) {
    globalForBoss.__leadFinderBoss = startBoss().catch((error: unknown) => {
      // Do not cache a rejected start: the next request should be able to retry.
      globalForBoss.__leadFinderBoss = undefined;
      throw error;
    });
  }
  return globalForBoss.__leadFinderBoss;
}

/** Register a batch worker. pg-boss always invokes handlers with an array of jobs. */
export async function registerWorker<K extends keyof JobPayloadMap>(
  name: K,
  handler: JobHandler<K>,
  options?: { batchSize?: number; pollingIntervalSeconds?: number },
): Promise<string> {
  const boss = await getBoss();
  return boss.work<JobPayloadMap[K]>(
    name,
    {
      batchSize: options?.batchSize ?? 1,
      pollingIntervalSeconds: options?.pollingIntervalSeconds ?? 2,
    },
    async (jobs) => handler(jobs),
  );
}

export async function sendJob<K extends keyof JobPayloadMap>(
  name: K,
  data: JobPayloadMap[K],
  options?: { singletonKey?: string; retryLimit?: number; expireInSeconds?: number },
): Promise<string | null> {
  const boss = await getBoss();
  const sendOptions: SendOptions = {
    retryLimit: options?.retryLimit ?? 2,
    retryDelay: 5,
    expireInSeconds: options?.expireInSeconds ?? 15 * 60,
  };
  if (options?.singletonKey) sendOptions.singletonKey = options.singletonKey;
  return boss.send(name, data, sendOptions);
}

export async function stopBoss(): Promise<void> {
  if (!globalForBoss.__leadFinderBoss) return;
  const boss = await globalForBoss.__leadFinderBoss;
  await boss.stop({ graceful: true, timeout: 15_000 });
  globalForBoss.__leadFinderBoss = undefined;
}
