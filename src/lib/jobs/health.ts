import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { JOB_NAMES } from "@/lib/jobs/boss";

/**
 * pg-boss keeps a heartbeat row for every running instance. A scan or import
 * job only starts when a worker process is polling the queue, so the app must
 * be able to tell the user when no worker is running instead of leaving jobs
 * "queued" forever with no explanation.
 */
const ACTIVE_WINDOW_SECONDS = 90;
const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface WorkerHealth {
  online: boolean;
  queues: string[];
  heartbeatAt: string | null;
}

function bossSchema(): string {
  return SCHEMA_PATTERN.test(env.pgBossSchema) ? env.pgBossSchema : "pgboss";
}

export interface WorkerInstanceRow {
  heartbeat_on: Date | string | null;
  workers: unknown;
}

function heartbeatIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Pure parser so the online/queue rules are testable without pg-boss. */
export function parseWorkerHealth(rows: WorkerInstanceRow[]): WorkerHealth {
  const queues = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.workers)) continue;
    for (const worker of row.workers) {
      if (worker && typeof worker === "object" && "queue" in worker) {
        const queue = (worker as { queue?: unknown }).queue;
        if (typeof queue === "string" && queue) queues.add(queue);
      }
    }
  }

  return {
    online: queues.size > 0,
    queues: [...queues].sort(),
    heartbeatAt: heartbeatIso(rows[0]?.heartbeat_on ?? null),
  };
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  if (env.inlineJobs) {
    // Work runs inside the request, so there is no worker heartbeat to look for.
    return {
      online: true,
      queues: Object.values(JOB_NAMES).sort(),
      heartbeatAt: new Date().toISOString(),
    };
  }
  try {
    const result = await pool.query<WorkerInstanceRow>(
      `select heartbeat_on, workers
         from ${bossSchema()}.instance
        where stopped_on is null
          and heartbeat_on > now() - interval '${ACTIVE_WINDOW_SECONDS} seconds'
        order by heartbeat_on desc`,
    );
    return parseWorkerHealth(result.rows);
  } catch {
    // The pgboss schema may not exist yet on a fresh install. Treat that,
    // and any database hiccup, as "no worker is running" rather than failing
    // the page that asked.
    return { online: false, queues: [], heartbeatAt: null };
  }
}

export function hasWorkerQueue(health: WorkerHealth, queue: string): boolean {
  return health.queues.includes(queue);
}

export function isScanWorkerOnline(health: WorkerHealth): boolean {
  return hasWorkerQueue(health, JOB_NAMES.scanBusiness);
}

export function isImportWorkerOnline(health: WorkerHealth): boolean {
  return hasWorkerQueue(health, JOB_NAMES.importProcess);
}
