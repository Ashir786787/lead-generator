import { ObjectId, type Filter } from "mongodb";
import { collections } from "@/lib/db";
import type { LiveEventDoc } from "@/lib/db/types";

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

export interface EventCursor {
  createdAt: Date;
  id: string;
}

const POLL_INTERVAL_MS = 1_000;
const MAX_PAYLOAD_BYTES = 7_900;

/**
 * Events are appended to a Mongo collection (expired after an hour by a TTL
 * index) and streamed by polling. That replaces the previous LISTEN/NOTIFY
 * connection, which serverless functions cannot keep open.
 */
export async function publishEvent(
  workspaceId: string,
  type: LiveEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  let safePayload = payload;
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    safePayload = { truncated: true };
  }
  await collections.liveEvents.insertOne({
    // ObjectId hex sorts by creation time, which makes it a reliable cursor.
    _id: new ObjectId().toHexString(),
    workspaceId,
    type,
    payload: safePayload,
    ts: Date.now(),
    createdAt: new Date(),
  });
}

function toLiveEvent(doc: LiveEventDoc): LiveEvent {
  return {
    workspaceId: doc.workspaceId,
    type: doc.type as LiveEventType,
    payload: doc.payload ?? {},
    ts: doc.ts,
  };
}

export async function listEventsSince(
  workspaceId: string,
  cursor: EventCursor | null,
  limit = 100,
): Promise<{ events: LiveEvent[]; cursor: EventCursor | null }> {
  const filter: Filter<LiveEventDoc> = cursor
    ? {
        workspaceId,
        $or: [
          { createdAt: { $gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $gt: cursor.id } },
        ],
      }
    : { workspaceId };

  const rows = await collections.liveEvents
    .find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .toArray();

  const last = rows.at(-1);
  return {
    events: rows.map(toLiveEvent),
    cursor: last ? { createdAt: last.createdAt, id: last._id } : cursor,
  };
}

/**
 * Poll for new workspace events until the signal aborts. The caller owns the
 * abort signal and is responsible for closing the SSE stream.
 */
export function openEventListener(
  workspaceId: string,
  onEvent: (event: LiveEvent) => void,
  signal: AbortSignal,
): { close: () => void } {
  let cursor: EventCursor | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    try {
      const result = await listEventsSince(workspaceId, cursor);
      cursor = result.cursor;
      for (const event of result.events) onEvent(event);
    } catch {
      /* transient database errors must not kill the stream */
    } finally {
      running = false;
      if (!signal.aborted) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  void poll();

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
