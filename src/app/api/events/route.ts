import { getWorkspaceContext } from "@/lib/auth/session";
import { openEventListener } from "@/lib/events/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-sent events for this workspace only. The LISTEN connection filters by
 * workspace_id before anything is written to the client stream.
 */
export async function GET(request: Request) {
  const ctx = await getWorkspaceContext();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "connected", workspaceId: ctx.workspaceId, ts: Date.now() });

      const listener = await openEventListener((event) => {
        if (event.workspaceId !== ctx.workspaceId) return;
        send(event);
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
        }
      }, 20_000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        void listener.close().catch(() => undefined);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      /* request.signal handles the listener close */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
