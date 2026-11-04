import { Client } from "pg";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

export const EVENT_CHANNEL = "leadfinder_events";

export type LiveEventType =
  | "lead.updated"
  | "lead.created"
  | "scan.queued"
  | "scan.progress"
  | "scan.completed"
  | "scan.failed"
  | "import.progress"
  | "import.completed"
  | "import.failed"
  | "export.ready"
  | "export.failed"
  | "duplicate.detected"
  | "duplicates.resolved"
  | "score.recalculated"
  | "job.cancelled"
  | "test.event";

export interface LiveEvent {
  workspaceId: string;
  type: LiveEventType;
  payload: Record<string, unknown>;
  ts: number;
}

export async function publishEvent(
  workspaceId: string,
  type: LiveEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const message = JSON.stringify({ workspaceId, type, payload, ts: Date.now() } satisfies LiveEvent);
  if (Buffer.byteLength(message, "utf8") > 7900) {
    const small = JSON.stringify({ workspaceId, type, payload: { truncated: true }, ts: Date.now() });
    await pool.query("SELECT pg_notify($1, $2)", [EVENT_CHANNEL, small]);
    return;
  }
  await pool.query("SELECT pg_notify($1, $2)", [EVENT_CHANNEL, message]);
}

/** Open a dedicated LISTEN connection. Caller owns close(). */
export async function openEventListener(
  onEvent: (event: LiveEvent) => void,
): Promise<{ close: () => Promise<void>; ready: Promise<void> }> {
  const client = new Client({ connectionString: env.databaseUrl });
  let closed = false;
  await client.connect();
  client.on("notification", (message) => {
    if (!message.payload) return;
    try {
      const event = JSON.parse(message.payload) as LiveEvent;
      if (typeof event.workspaceId === "string" && typeof event.type === "string") onEvent(event);
    } catch {
      /* ignore malformed notifications */
    }
  });
  client.on("error", () => {
    if (!closed) void client.end().catch(() => undefined);
  });
  await client.query(`LISTEN ${EVENT_CHANNEL}`);

  return {
    ready: Promise.resolve(),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.end().catch(() => undefined);
    },
  };
}
