import { desc } from "drizzle-orm";

import { scrubSecrets } from "@/server/connectors/scrub-secrets";
import { SecretLockedError } from "@/server/connectors/secrets";
import { db, newId, nowIso, tables } from "@/server/db";
import type { AGENT_ACTION_RESULTS, GATE_LEVELS } from "@/server/db/schema";

export type GateLevel = (typeof GATE_LEVELS)[number];
export type AgentActionResult = (typeof AGENT_ACTION_RESULTS)[number];
type RunGate = Exclude<GateLevel, "read">;

export const UNSCRUBBED_LOCKED = "[unscrubbed: secret store locked]";

function scrubbedJson(input: unknown): string {
  try {
    return scrubSecrets(JSON.stringify(input ?? {}));
  } catch (err) {
    if (err instanceof SecretLockedError) return UNSCRUBBED_LOCKED;
    throw err;
  }
}

export interface JournaledCall {
  callId: string;
  caller: string;
  tool: string;
  input: string;
  gate: RunGate;
  draftId?: string;
}

/** Write-ahead row, before the tool runs. A throw here means the tool must not run. */
export function journalPending(caller: string, tool: string, args: unknown, gate: RunGate, draftId?: string): JournaledCall {
  const call = { callId: newId(), caller, tool, input: scrubbedJson(args), gate, draftId };
  db.insert(tables.agentActions).values({ ...call, at: nowIso(), result: "pending" }).run();
  return call;
}

export function journalOutcome(call: JournaledCall, result: "ok" | "error" | "rejected"): void {
  db.insert(tables.agentActions).values({ ...call, at: nowIso(), result }).run();
}

export function draftGatedCall(caller: string, tool: string, input: unknown): string {
  const draftId = newId();
  const at = nowIso();
  db.transaction((tx) => {
    tx.insert(tables.gateDrafts).values({ id: draftId, tool, rawInput: input ?? {}, caller, createdAt: at }).run();
    tx.insert(tables.agentActions).values({ callId: newId(), at, caller, tool, input: scrubbedJson(input), result: "drafted", gate: "gate2", draftId }).run();
  });
  return draftId;
}

export function listAgentActions(limit = 100) {
  return db.select().from(tables.agentActions).orderBy(desc(tables.agentActions.id)).limit(limit).all();
}
