"use client";

import { useEffect } from "react";

function post(event: string, fields: Record<string, unknown>): void {
  void fetch("/api/logs/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      source: "frontend",
      event,
      fields,
    }),
  }).catch(() => {
    // Reporting an error must not itself throw.
  });
}

/** Registers global handlers that report unhandled client errors to /api/logs/ingest.
 *  Mount once, high in the shell tree. Renders nothing. */
export function ClientErrorReporter(): null {
  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      post("client.error", { message: e.message, source: e.filename, line: e.lineno });
    const onRejection = (e: PromiseRejectionEvent) =>
      post("client.unhandledrejection", { message: String((e.reason as Error)?.message ?? e.reason) });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
