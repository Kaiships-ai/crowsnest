/**
 * Pure SLA evaluation for a single Run snapshot. No I/O, no db: callers (the reaper,
 * the runs list, the run detail view) supply everything, including the staleness
 * threshold, so this module has nothing to import from the rest of the app.
 */

export type SlaInput = {
  status: string;
  startedAt: string;
  heartbeatAt: string | null;
  budgetMs: number;
  staleMs: number;
  now: number;
};

export type SlaVerdict = {
  overBudget: boolean;
  stuck: boolean;
  breach: boolean;
};

const NO_BREACH: SlaVerdict = { overBudget: false, stuck: false, breach: false };

export function evaluateSla(input: SlaInput): SlaVerdict {
  // Only a running run can breach: finished runs (success, error, cancelled, ...) are done.
  if (input.status !== "running") return NO_BREACH;

  const startedAtMs = Date.parse(input.startedAt);
  if (Number.isNaN(startedAtMs)) return NO_BREACH;

  const overBudget = input.now - startedAtMs > input.budgetMs;

  let stuck = false;
  if (input.heartbeatAt !== null) {
    const heartbeatAtMs = Date.parse(input.heartbeatAt);
    if (!Number.isNaN(heartbeatAtMs)) {
      stuck = input.now - heartbeatAtMs > input.staleMs;
    }
  }

  return { overBudget, stuck, breach: overBudget || stuck };
}
