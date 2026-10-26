import { instagramGraph } from "@/server/connectors/instagram-graph/manifest";
import { CONNECTORS, listConnectors, type ConnectorView } from "@/server/connectors/registry";
import type { Connector } from "@/server/connectors/types";
import { GRAPH_CALLS_PER_HOUR, graphCallsInLastHour } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import { DAILY_PULL_HOUR, lastPulls, pullSlotDate, type LastPull } from "@/server/services/daily-pull";

export type VaultState = "running" | "error" | "stale" | "not-connected" | "partial";

export interface VaultRow {
  id: string;
  label: string;
  state: VaultState;
  missingSecretLabels: string[];
  secrets: ConnectorView["secrets"];
  canPull: boolean;
  lastPull: LastPull | null;
  nextPullAt: string;
  graphCallsLeft: number | null;
}

export function nextPullAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(DAILY_PULL_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function stateOf(view: ConnectorView, canPull: boolean, last: LastPull | null, now: Date): VaultState {
  if (view.status !== "configured") return "not-connected";
  if (!canPull) return "running";
  if (last?.outcome === "failed") return "error";
  if (last?.outcome === "partial") return "partial";
  if (last?.outcome === "complete" && last.slot === pullSlotDate(now)) return "running";
  return "stale";
}

export function getVaultBoard(now: Date = clockNow(), registry: Connector[] = CONNECTORS): VaultRow[] {
  const last = lastPulls();
  const next = nextPullAt(now).toISOString();
  return listConnectors(registry).map((view) => {
    const canPull = Boolean(registry.find((c) => c.manifest.id === view.id)?.adapter?.pull);
    const lastPull = last.get(view.id) ?? null;
    return {
      id: view.id,
      label: view.label,
      state: stateOf(view, canPull, lastPull, now),
      missingSecretLabels: view.secrets.filter((s) => !s.optional && s.source === "none").map((s) => s.label),
      secrets: view.secrets,
      canPull,
      lastPull,
      nextPullAt: next,
      graphCallsLeft: view.id === instagramGraph.id ? Math.max(0, GRAPH_CALLS_PER_HOUR - graphCallsInLastHour(now)) : null,
    };
  });
}
