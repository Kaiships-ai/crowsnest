import { instagramGraph } from "@/server/connectors/instagram-graph/manifest";
import { CONNECTORS, listConnectors, type ConnectorView } from "@/server/connectors/registry";
import type { Connector } from "@/server/connectors/types";
import { GRAPH_CALLS_PER_HOUR, graphCallsInLastHour } from "@/server/graph/client";
import { clockNow } from "@/server/lib/clock";
import { cardStatus, parseSummary, readStatuses, type CardStatus, type ConnectorSummary } from "@/server/services/connector-status";

/** The one state a Sources card shows. A pull in flight is `pulling`, with its progress on the row; a check in flight lives only in the renderer. */
export type CardState = "not-connected" | CardStatus["state"];

export interface VaultRow {
  id: string;
  label: string;
  state: CardState;
  /** One sentence: what is wrong and what to do. Null when nothing is wrong. */
  message: string | null;
  detail: string | null;
  checkedAt: string | null;
  pulledAt: string | null;
  progress: { done: number; total: number | null; label: string | null; startedAt: string | null } | null;
  /** No pull or test before this time. */
  retryAfter: string | null;
  summary: ConnectorSummary;
  missingSecretLabels: string[];
  secrets: ConnectorView["secrets"];
  canPull: boolean;
  graphCallsLeft: number | null;
}

export function getVaultBoard(now: Date = clockNow(), registry: Connector[] = CONNECTORS): VaultRow[] {
  const statuses = readStatuses(now);
  return listConnectors(registry).map((view) => {
    const row = statuses.get(view.id);
    const card = cardStatus(row);
    return {
      id: view.id,
      label: view.label,
      state: view.status === "configured" ? card.state : "not-connected",
      message: card.message,
      detail: card.detail,
      checkedAt: row?.checkedAt ?? null,
      pulledAt: row?.pulledAt ?? null,
      progress: row?.pullState === "pulling" ? { done: row.progressDone ?? 0, total: row.progressTotal, label: row.progressLabel, startedAt: row.startedAt } : null,
      retryAfter: row?.retryAfter ?? null,
      summary: parseSummary(row?.summary ?? null),
      missingSecretLabels: view.secrets.filter((s) => !s.optional && s.source === "none").map((s) => s.label),
      secrets: view.secrets,
      canPull: Boolean(registry.find((c) => c.manifest.id === view.id)?.adapter?.pull),
      graphCallsLeft: view.id === instagramGraph.id ? Math.max(0, GRAPH_CALLS_PER_HOUR - graphCallsInLastHour(now)) : null,
    };
  });
}
