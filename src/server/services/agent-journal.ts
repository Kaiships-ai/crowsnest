import { desc } from "drizzle-orm";

import { scrubSecrets } from "@/server/connectors/scrub-secrets";
import { db, newId, nowIso, tables } from "@/server/db";
import type { AGENT_ACTION_RESULTS, GATE_LEVELS } from "@/server/db/schema";

export type GateLevel = (typeof GATE_LEVELS)[number];
export type AgentActionResult = (typeof AGENT_ACTION_RESULTS)[number];

interface AgentAction {
  caller: string;
  tool: string;
  input: unknown;
  result: Exclude<AgentActionResult, "drafted">;
  gate: Exclude<GateLevel, "read" | "gate2">;
}

const scrubbedJson = (input: unknown) => scrubSecrets(JSON.stringify(input ?? {}));

export function recordAgentAction({ caller, tool, input, result, gate }: AgentAction): void {
  db.insert(tables.agentActions).values({ at: nowIso(), caller, tool, input: scrubbedJson(input), result, gate }).run();
}

export function draftGatedCall(caller: string, tool: string, input: unknown): string {
  const draftId = newId();
  const at = nowIso();
  db.transaction((tx) => {
    tx.insert(tables.gateDrafts).values({ id: draftId, tool, input: input ?? {}, caller, createdAt: at }).run();
    tx.insert(tables.agentActions).values({ at, caller, tool, input: scrubbedJson(input), result: "drafted", gate: "gate2", draftId }).run();
  });
  return draftId;
}

export function listAgentActions(limit = 100) {
  return db.select().from(tables.agentActions).orderBy(desc(tables.agentActions.id)).limit(limit).all();
}
