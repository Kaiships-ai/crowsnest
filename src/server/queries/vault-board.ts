import { instagramGraph } from "@/server/connectors/instagram-graph/manifest";
import { CONNECTORS, listConnectors, type ConnectorView } from "@/server/connectors/registry";
import type { Connector } from "@/server/connectors/types";
import { GRAPH_CALLS_PER_HOUR, graphCallsInLastHour } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import { readStatuses, type StatusRow } from "@/server/services/connector-status";

/** The one state a Sources card shows. In-flight checking and pulling live only in the renderer. */
export type CardState = "not-connected" | StatusRow["state"];

export interface VaultRow {
  id: string;
  label: string;
  state: CardState;
  /** One sentence: what is wrong and what to do. Null when nothing is wrong. */
  message: string | null;
  detail: string | null;
  checkedAt: string | null;
  pulledAt: string | null;
  missingSecretLabels: string[];
  secrets: ConnectorView["secrets"];
  canPull: boolean;
  graphCallsLeft: number | null;
}

function stateOf(view: ConnectorView, row: StatusRow | undefined): CardState {
  if (view.status !== "configured") return "not-connected";
  // Set up but never checked or pulled: ready until a check or pull says otherwise.
  return row?.state ?? "ready";
}

export function getVaultBoard(now: Date = clockNow(), registry: Connector[] = CONNECTORS): VaultRow[] {
  const statuses = readStatuses();
  return listConnectors(registry).map((view) => {
    const row = statuses.get(view.id);
    return {
      id: view.id,
      label: view.label,
      state: stateOf(view, row),
      message: row?.message ?? null,
      detail: row?.detail ?? null,
      checkedAt: row?.checkedAt ?? null,
      pulledAt: row?.pulledAt ?? null,
      missingSecretLabels: view.secrets.filter((s) => !s.optional && s.source === "none").map((s) => s.label),
      secrets: view.secrets,
      canPull: Boolean(registry.find((c) => c.manifest.id === view.id)?.adapter?.pull),
      graphCallsLeft: view.id === instagramGraph.id ? Math.max(0, GRAPH_CALLS_PER_HOUR - graphCallsInLastHour(now)) : null,
    };
  });
}
