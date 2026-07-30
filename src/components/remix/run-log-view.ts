import type { RemixRunRow } from "@/server/queries/remix-runs";

/**
 * Pure view logic for the run log (v1-scope.md, Remix studio P0 #5) and for the
 * proxy-down block surface (#2), kept out of run-log.tsx/generation-blocked.tsx so
 * both are testable without mounting a component — same split as
 * `sync/failure-strip-view.ts`.
 */

export type RunTone = "pos" | "warn" | "bad";

const VARIANT_COUNT_RE = /^(\d+) of (\d+) variants succeeded$/;

/**
 * `generateVariants` (services/remix.ts) writes `outcome: "success"` whenever at
 * least one variant came back, even if the rest failed — so a run row's `outcome`
 * column alone can't tell "3 of 3" from "1 of 3" apart. This reads the same
 * `detail` string the row already stores ("N of M variants succeeded", never
 * fabricated — it's the actual count from that call) to tell a partial success
 * from a clean one, so the run log never shows a partial attempt in the same tone
 * as a full one.
 */
export function runTone(run: RemixRunRow): RunTone {
  if (run.outcome === "error") return "bad";
  const match = VARIANT_COUNT_RE.exec(run.detail);
  if (match && Number(match[1]) < Number(match[2])) return "warn";
  return "pos";
}

export function runToneLabel(tone: RunTone): string {
  switch (tone) {
    case "pos":
      return "Success";
    case "warn":
      return "Partial";
    case "bad":
      return "Failed";
  }
}

/** 340 -> "340ms", 2100 -> "2.1s". Sub-second calls (most hook/outline generations)
 *  stay legible instead of rounding to "0.3s". */
export function formatRunElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Whether the most recent generation attempts look like the local model proxy
 * itself is unreachable, rather than some other failure (bad key, rate limit,
 * malformed output). Grounded in what the SDK actually throws for a refused TCP
 * connection — `Anthropic.APIConnectionError`'s default message, "Connection
 * error." (verified against the down proxy in this environment) — which
 * `generateHooks`/`generateOutline` store verbatim as `errorMessage`.
 *
 * `generateVariants` never gets that far: a rejected `Promise.allSettled` entry is
 * caught per-variant and only the count survives ("0 of 3 variants succeeded"), so
 * a total failure there (zero successes) is the only signal that stage can offer —
 * treated as corroborating evidence, not proof on its own, since Hook/Style share
 * the same proxy and any one of the three failing this way in the same session
 * points at the same cause.
 */
export function isConnectionFailure(run: RemixRunRow): boolean {
  if (run.outcome !== "error") return false;
  const text = run.errorMessage ?? run.detail;
  if (/connection error|econnrefused|fetch failed|network error/i.test(text)) return true;
  if (run.stage === "script") {
    const match = VARIANT_COUNT_RE.exec(run.detail);
    if (match && Number(match[1]) === 0) return true;
  }
  return false;
}

/** `runs` is newest-first (`getRemixRunLog`'s own order). Looks at the most recent
 *  handful rather than only the single latest row, so one connection failure isn't
 *  erased the instant a differently-flavored error follows it. */
export function isProxyLikelyDown(runs: RemixRunRow[]): boolean {
  return runs.slice(0, 3).some(isConnectionFailure);
}
