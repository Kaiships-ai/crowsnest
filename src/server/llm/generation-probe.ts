import { PING_TIMED_OUT, LLM_PING_TIMEOUT_MS, withTimeout } from "@/components/status/dependency-status";
import { errorMessage } from "@/server/lib/action-result";
import { getLlm, type LlmClient } from "./client";

/**
 * The real generation health check `dependency-status.ts`'s own module doc names as
 * missing: `classifyLlmStatus` there never reports proxy-mode `"up"`, because a
 * passing `ping()` (a $0 `count_tokens` call) only proves 9router itself answers, not
 * that the model behind it generates anything — verified directly against the running
 * proxy, `count_tokens` tokenizes locally while `/v1/messages` can 410 for the same
 * model. This module closes that gap with a probe that actually calls `generateText`.
 *
 * Kept as a sibling of `dependency-status.ts` rather than folded into it: that module
 * is deliberately pure (its own doc: "no React, no fetching, just... what does this
 * mean"), so its vitest coverage needs no server-only imports. This one calls
 * `getLlm()`, which resolves a secret through the sqlite-backed secrets store — real
 * I/O that belongs on the server side of the same boundary `testAnthropicKeyAction`
 * (settings-actions.ts) already lives on.
 *
 * The only live 9router models today are text-only (no vision), so the probe sends a
 * one-word text prompt and nothing else — never image content.
 */

export type GenerationProbeState = "up" | "reachable_unverified" | "down";

export interface GenerationProbeResult {
  state: GenerationProbeState;
  /** The most useful error string available for this state — the generation failure
   *  when the proxy answered but generation didn't, the reachability failure when
   *  nothing answered at all. Null for "up". */
  detail: string | null;
}

const PROBE_SYSTEM = "Reply with exactly one word and nothing else.";
const PROBE_USER = "Say OK.";
const PROBE_MAX_TOKENS = 8;

async function tryPing(client: LlmClient, timeoutMs: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await withTimeout(
    client
      .ping()
      .then(() => ({ ok: true as const }))
      .catch((e: unknown) => ({ ok: false as const, error: errorMessage(e) })),
    timeoutMs,
  );
  return result === PING_TIMED_OUT ? { ok: false, error: "The check didn't get a response in time." } : result;
}

async function tryGenerate(client: LlmClient, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const result = await withTimeout(
    client
      .generateText({ system: PROBE_SYSTEM, user: PROBE_USER, maxTokens: PROBE_MAX_TOKENS })
      .then((text) => ({ ok: true as const, text }))
      .catch((e: unknown) => ({ ok: false as const, error: errorMessage(e) })),
    timeoutMs,
  );
  return result === PING_TIMED_OUT ? { ok: false, error: "The check didn't get a response in time." } : result;
}

/**
 * Runs the ping and the generation probe concurrently (each independently timed out at
 * `timeoutMs`, so the pair never takes longer than one call would) and classifies the
 * result:
 *  - generation returned non-empty text -> "up" (the only state that proves the
 *    configured model actually works, proxy or not)
 *  - generation failed but the ping got *some* response -> "reachable_unverified",
 *    same honesty `classifyLlmStatus` already gives a passing proxy ping
 *  - neither got a response -> "down"
 *
 * `llm` is an injectable seam purely for tests, same pattern `testAnthropicKeyAction`
 * uses: the real caller always omits it, resolving through the real `getLlm()`
 * singleton. `getLlm()` itself can throw (`NoApiKeyError` when no key is configured at
 * all) — caught here and reported as "down" with that message, since no key means no
 * usable LLM either way.
 */
export async function probeLlmGeneration(llm?: LlmClient, timeoutMs: number = LLM_PING_TIMEOUT_MS): Promise<GenerationProbeResult> {
  let client: LlmClient;
  try {
    client = llm ?? getLlm();
  } catch (e) {
    return { state: "down", detail: errorMessage(e) };
  }

  const [pingResult, genResult] = await Promise.all([tryPing(client, timeoutMs), tryGenerate(client, timeoutMs)]);

  if (genResult.ok && genResult.text.trim().length > 0) {
    return { state: "up", detail: null };
  }
  if (pingResult.ok) {
    return { state: "reachable_unverified", detail: genResult.ok ? "generation returned no text" : genResult.error };
  }
  return { state: "down", detail: pingResult.ok ? null : pingResult.error };
}
