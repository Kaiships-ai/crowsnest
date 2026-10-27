import { sql } from "drizzle-orm";

import type { Connector } from "@/server/connectors/types";
import { CONNECTORS } from "@/server/connectors/registry";
import { db } from "@/server/db";
import { clockNow } from "@/server/lib/clock";
import type { CountId } from "@/server/metrics/ledger";
import { getFunnelBoard, type BoardStep, type FunnelStep } from "@/server/queries/funnel-board";
import { getVaultBoard, type VaultRow } from "@/server/queries/vault-board";

export type Drop =
  | { status: "no-target" }
  | { status: "missing" }
  | { status: "value"; step: CountId; label: string; rate: number; target: number; capturedAt: string };

export interface TodayBoard {
  at: string;
  steps: BoardStep[];
  offer: BoardStep[];
  drop: Drop;
  gates: { proposedPlansAhead: number; pendingDrafts: number };
  pulls: Pick<VaultRow, "id" | "label" | "state" | "pulledAt">[];
}

export function biggestDrop(steps: FunnelStep[]): Drop {
  const targeted = steps.flatMap((s) => (s.rate && s.rate.target !== null ? [{ step: s, rate: s.rate, target: s.rate.target }] : []));
  if (targeted.length === 0) return { status: "no-target" };
  let worst: Drop = { status: "missing" };
  for (const { step, rate, target } of targeted) {
    if (rate.reading.status !== "value") continue;
    if (worst.status === "value" && rate.reading.value / target >= worst.rate / worst.target) continue;
    worst = { status: "value", step: step.id, label: rate.label, rate: rate.reading.value, target, capturedAt: rate.reading.capturedAt };
  }
  return worst;
}

function waitingGates(): TodayBoard["gates"] {
  const row = db.get<{ plans: number; drafts: number }>(sql`
    SELECT
      (SELECT count(*) FROM plan_versions p WHERE p.status = 'proposed' AND p.version > coalesce(
        (SELECT max(l.version) FROM plan_versions l WHERE l.period = p.period AND l.period_key = p.period_key AND l.status = 'live'), 0)) AS plans,
      (SELECT count(*) FROM gate_drafts WHERE status = 'pending') AS drafts
  `);
  return { proposedPlansAhead: row.plans, pendingDrafts: row.drafts };
}

export async function getTodayBoard(now: Date = clockNow(), registry: Connector[] = CONNECTORS): Promise<TodayBoard> {
  const { steps } = await getFunnelBoard(now, registry);
  return {
    at: now.toISOString(),
    steps,
    offer: steps.filter((s) => s.id === "checkout" || s.id === "purchase"),
    drop: biggestDrop(steps),
    gates: waitingGates(),
    pulls: getVaultBoard(now, registry).map(({ id, label, state, pulledAt }) => ({ id, label, state, pulledAt })),
  };
}
