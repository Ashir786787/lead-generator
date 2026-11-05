import { describe, expect, it } from "vitest";
import {
  hasWorkerQueue,
  isImportWorkerOnline,
  isScanWorkerOnline,
  parseWorkerHealth,
  type WorkerHealth,
} from "@/lib/jobs/health";

function health(queues: string[]): WorkerHealth {
  return { online: queues.length > 0, queues, heartbeatAt: "2026-11-05T08:00:00.000Z" };
}

describe("worker health", () => {
  it("treats an empty instance list as offline", () => {
    expect(parseWorkerHealth([])).toEqual({ online: false, queues: [], heartbeatAt: null });
  });

  it("collects queues from live pg-boss instances and de-duplicates them", () => {
    const parsed = parseWorkerHealth([
      {
        heartbeat_on: new Date("2026-11-05T08:00:00.000Z"),
        workers: [{ queue: "scan.business" }, { queue: "import.process" }],
      },
      {
        heartbeat_on: new Date("2026-11-05T07:59:00.000Z"),
        workers: [{ queue: "scan.business" }, { queue: "score.recalculate" }],
      },
    ]);

    expect(parsed.online).toBe(true);
    expect(parsed.queues).toEqual(["import.process", "scan.business", "score.recalculate"]);
    expect(parsed.heartbeatAt).toBe("2026-11-05T08:00:00.000Z");
  });

  it("ignores web instances that have no registered workers", () => {
    const parsed = parseWorkerHealth([
      { heartbeat_on: "2026-11-05T08:00:00.000Z", workers: [] },
      { heartbeat_on: null, workers: null },
    ]);

    expect(parsed.online).toBe(false);
    expect(parsed.queues).toEqual([]);
  });

  it("distinguishes the scan queue from a worker that only handles other jobs", () => {
    const other = health(["import.process", "score.recalculate"]);
    expect(other.online).toBe(true);
    expect(hasWorkerQueue(other, "scan.business")).toBe(false);
    expect(isScanWorkerOnline(other)).toBe(false);
    expect(isImportWorkerOnline(other)).toBe(true);
  });

  it("reports the scan and import queues when both are registered", () => {
    const both = health(["scan.business", "import.process"]);
    expect(isScanWorkerOnline(both)).toBe(true);
    expect(isImportWorkerOnline(both)).toBe(true);
  });
});
