import { listRuns, getRun } from "@/server/queries/runs";

/**
 * GET /api/runs/stream - server sent events for the Runs screens. Emits the current
 * listRuns() payload every REFRESH_MS, and when given ?runId=, also that run's latest
 * log events so the detail page can tail the trace live.
 *
 * Polling the local sqlite db on an interval is the local-first, single-user simple path:
 * one reader, one writer, one machine. It is not a WebSocket (no client-to-server
 * channel is needed) and not a client poll (the browser opens one long-lived connection
 * and the server pushes). better-sqlite3 has no edge build, so this is a Node route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_MS = 2000;

export async function GET(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("runId") ?? undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const tick = () => {
        if (closed) return;
        try {
          const payload = {
            runs: listRuns(),
            events: runId ? (getRun(runId)?.events ?? []) : null,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // A read failure must not kill the stream. The client keeps the last good
          // payload on screen and the next tick retries.
        }
      };

      tick();
      const interval = setInterval(tick, REFRESH_MS);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
