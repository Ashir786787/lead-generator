import { assertSafeConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getBoss, registerWorker, stopBoss, JOB_NAMES } from "@/lib/jobs/boss";
import { processImport } from "@/lib/import/process";
import { processScan } from "@/lib/scan/process";
import { recalculateWorkspaceScores } from "@/lib/score/service";
import { publishEvent } from "@/lib/events/bus";

assertSafeConfig();

const running = new Set<string>();

async function main(): Promise<void> {
  const boss = await getBoss();
  logger.info("Worker connected to pg-boss");

  await registerWorker(JOB_NAMES.importProcess, async (jobs) => {
    for (const job of jobs) {
      const { workspaceId, importJobId } = job.data;
      if (running.has(job.id)) continue;
      running.add(job.id);
      try {
        const result = await processImport(workspaceId, importJobId);
        logger.info({ importJobId, result: result.status }, "Import job processed");
      } catch (error) {
        logger.error({ err: error, importJobId }, "Import worker crashed");
        throw error;
      } finally {
        running.delete(job.id);
      }
    }
  });

  await registerWorker(
    JOB_NAMES.scanBusiness,
    async (jobs) => {
      await Promise.all(
        jobs.map(async (job) => {
          const { workspaceId, businessId, scanJobId, force } = job.data;
          await processScan(workspaceId, businessId, scanJobId, Boolean(force));
        }),
      );
    },
    { batchSize: 5, pollingIntervalSeconds: 2 },
  );

  await registerWorker(JOB_NAMES.healthcheck, async (jobs) => {
    for (const job of jobs) {
      logger.info({ workspaceId: job.data.workspaceId }, "Healthcheck job received");
    }
  });

  await registerWorker(JOB_NAMES.scoreRecalculate, async (jobs) => {
    for (const job of jobs) {
      const { workspaceId } = job.data;
      const result = await recalculateWorkspaceScores(workspaceId, async (done, total) => {
        await publishEvent(workspaceId, "score.recalculated", { done, total });
      });
      logger.info({ workspaceId, ...result }, "Workspace scores recalculated");
    }
  });

  await boss.send(JOB_NAMES.healthcheck, { workspaceId: undefined }, { retryLimit: 0 });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Worker shutting down");
    await stopBoss().catch((error: unknown) => logger.error({ err: error }, "Worker shutdown failed"));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("Worker ready");
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Worker failed to start");
  process.exit(1);
});
