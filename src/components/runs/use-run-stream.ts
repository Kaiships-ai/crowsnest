"use client";

import { useEffect, useState } from "react";

import type { RunSummary } from "@/server/queries/runs";
import type { LogEventRow } from "@/server/logs/store";

interface StreamPayload {
  runs: RunSummary[];
  events: LogEventRow[] | null;
}

export interface RunStream {
  runs: RunSummary[];
  events: LogEventRow[];
  connected: boolean;
}

/**
 * Subscribes to /api/runs/stream (SSE). Pass a runId to also receive that run's log
 * events for the live trace tail. EventSource reconnects on its own after a drop; the
 * `connected` flag mirrors that so the UI can show a "live" vs "reconnecting" hint.
 *
 * Seed the initial `runs` from the server render (see the page components) so the first
 * paint is not empty while the first SSE message is in flight. useState captures the
 * seed once on mount; later renders' seedRuns are ignored, which is what a seed means.
 */
export function useRunStream(runId?: string, seedRuns: RunSummary[] = []): RunStream {
  const [runs, setRuns] = useState<RunSummary[]>(seedRuns);
  const [events, setEvents] = useState<LogEventRow[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = runId ? `/api/runs/stream?runId=${encodeURIComponent(runId)}` : "/api/runs/stream";
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource auto reconnects; flag flips back on the next onopen
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as StreamPayload;
        setRuns(payload.runs);
        if (payload.events !== null) setEvents(payload.events);
      } catch {
        // ignore a malformed frame, keep the last good state
      }
    };

    return () => es.close();
  }, [runId]);

  return { runs, events, connected };
}
