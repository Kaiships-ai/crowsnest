import { db, tables } from "../db";
import { getSettings } from "../settings";

/**
 * The `(shell)` layout's route guard (docs/product/v1-scope.md §2 "First run", AC 1 and
 * §4 decision 1). Split into a pure decision function and an async reader for the same
 * reason `failure-surface.ts`'s `classify` is separate from `getFailureStrip` — the rule
 * itself should be testable with no database in the loop.
 *
 * The gate is deliberately compound, not just `!firstRunCompleted`: a database that
 * already has channels (a seeded dev database, or one that predates this flag entirely)
 * must not suddenly redirect every route into onboarding. The flag alone decides once it
 * is true — it stays true even if every channel is later removed, so finishing first run
 * never re-triggers it — but while it is false, a real channel row already existing is
 * treated the same as having finished, because the thing this gate exists to catch is a
 * truly fresh install with nothing set up at all.
 */
export function shouldRedirectToFirstRun(input: { firstRunCompleted: boolean; hasChannels: boolean }): boolean {
  return !input.firstRunCompleted && !input.hasChannels;
}

export interface FirstRunGate {
  redirectToFirstRun: boolean;
  firstRunCompleted: boolean;
}

export async function getFirstRunGate(): Promise<FirstRunGate> {
  const [settings, existingChannel] = await Promise.all([
    getSettings(),
    db.select({ id: tables.channels.id }).from(tables.channels).limit(1),
  ]);
  const hasChannels = existingChannel.length > 0;
  return {
    redirectToFirstRun: shouldRedirectToFirstRun({ firstRunCompleted: settings.firstRunCompleted, hasChannels }),
    firstRunCompleted: settings.firstRunCompleted,
  };
}
