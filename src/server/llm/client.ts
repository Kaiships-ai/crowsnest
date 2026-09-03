import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getSecret } from "@/server/secrets/store";
import { routerReachable } from "./router-control";

/**
 * Thin wrapper around `@anthropic-ai/sdk` (Task 1, phase-3 plan) — every AI feature
 * (analyze, similar's future tag needs, remix) goes through `LlmClient` so services can
 * inject a fake in tests instead of hitting the network. See Global Constraints in
 * docs/superpowers/plans/2026-07-24-phase3-remix-vault.md: no temperature/top_p/thinking
 * params (Claude Sonnet 5 rejects non-default sampling params and adaptive thinking is
 * already the default when `thinking` is omitted), structured outputs via
 * `client.messages.parse()` + `zodOutputFormat()`, typed SDK error classes propagate
 * untouched (callers — server actions — catch them most-specific-first).
 */

/**
 * Thrown by `getLlm()` when `ANTHROPIC_API_KEY` is unset. Callers (server actions) catch
 * this and surface a friendly "add your key in Settings" Alert instead of a crash or a
 * raw SDK `AuthenticationError` — the keyless-mode contract (DESIGN.md §6): every page
 * still renders, AI features show this as an Alert.
 */
export class NoApiKeyError extends Error {
  constructor(message = "ANTHROPIC_API_KEY is not set — add it in Settings to enable AI features.") {
    super(message);
    this.name = "NoApiKeyError";
  }
}

/**
 * Thrown by `generateParsed()` when Claude's structured output still fails schema
 * validation after one retry (a `null` `parsed_output`).
 */
export class LlmParseError extends Error {
  constructor(message = "Claude's response didn't match the expected structured-output schema, even after a retry.") {
    super(message);
    this.name = "LlmParseError";
  }
}

export interface LlmClient {
  generateText(opts: { system: string; user: string; maxTokens?: number }): Promise<string>;
  generateParsed<T>(opts: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T>;
  /**
   * "Test connection" for the Settings page's API Keys section (Task 2, phase 4):
   * a tiny `count_tokens` call — costs $0, doesn't consume any generation quota —
   * that succeeds iff the configured key is valid and reachable. Throws (typed SDK
   * errors, same as generateText/generateParsed) rather than returning a result, so
   * callers reuse the same llm/error-message.ts mapping every other action already does.
   */
  ping(): Promise<void>;
}

const DEFAULT_MAX_TOKENS = 2048;

/**
 * `process.env.CLAUDE_MODEL ?? "claude-sonnet-5"` — spec §7 pins this default as Kai's
 * cost decision; never hardcode a different model. Exported (not just used internally)
 * so callers that persist which model produced a result — e.g. analyze.ts's
 * `video_analyses.model` column — don't re-derive the same env-resolution logic.
 */
export function resolveModel(): string {
  return process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
}

export function hasLlmKey(): boolean {
  return Boolean(getSecret("ANTHROPIC_API_KEY"));
}

class AnthropicLlmClient implements LlmClient {
  constructor(private readonly client: Anthropic) {}

  async generateText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const response = await this.client.messages.create({
      model: resolveModel(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user" as const, content: opts.user }],
    });

    // Narrow to text blocks only — a response could in principle carry other block
    // types (tool_use, etc.); we don't request tools here, but concatenating only
    // `type === "text"` blocks is the documented-safe way to read plain text back.
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    return text;
  }

  async generateParsed<T>(opts: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<T> {
    const request = {
      model: resolveModel(),
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user" as const, content: opts.user }],
      output_config: { format: zodOutputFormat(opts.schema) },
    };

    // One retry on a null parsed_output (malformed/refused structured output) before
    // giving up, per Task 1's spec. Non-2xx failures raise typed SDK errors from
    // `.parse()` directly (it wraps `.create()`) — those propagate to the caller
    // untouched rather than being retried here; only a *successful* response with a
    // null `parsed_output` triggers the retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.messages.parse(request);
      if (response.parsed_output !== null && response.parsed_output !== undefined) {
        return response.parsed_output as T;
      }
    }
    throw new LlmParseError();
  }

  async ping(): Promise<void> {
    await this.client.messages.countTokens({
      model: resolveModel(),
      messages: [{ role: "user" as const, content: "ping" }],
    });
  }
}

/**
 * OpenAI-compat router mode (e.g. 9router at `LLM_BASE_URL`). Local routers
 * translate the Anthropic *streaming* wire format correctly but not the non-streaming
 * one (raw provider JSON leaks through), and they ignore `output_config.format`
 * entirely because the free backing models have no Anthropic structured-outputs
 * support. So this client (a) always streams and reads the result via
 * `finalMessage()`, and (b) implements `generateParsed` as prompt-engineered JSON:
 * schema in the system prompt → fence-stripped `JSON.parse` → zod validation, with
 * the same one-retry-then-`LlmParseError` contract as the native client.
 */
class CompatLlmClient implements LlmClient {
  constructor(private readonly client: Anthropic) {}

  private async streamText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const message = await this.client.messages
      .stream({
        model: resolveModel(),
        max_tokens: opts.maxTokens ?? COMPAT_MAX_TOKENS,
        system: opts.system,
        messages: [{ role: "user" as const, content: opts.user }],
      })
      .finalMessage();

    // Routed models emit `thinking` blocks before the answer — concatenate only
    // text blocks, same narrowing as the native client.
    let text = "";
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
    }
    return text;
  }

  async generateText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
    return this.streamText(opts);
  }

  async generateParsed<T>(opts: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<T> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(opts.schema));
    const system =
      `${opts.system}\n\n` +
      `Respond with a single JSON object that validates against this JSON Schema:\n${jsonSchema}\n` +
      `Output ONLY the JSON object — no markdown fences, no commentary before or after.`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.streamText({ system, user: opts.user, maxTokens: opts.maxTokens });
      const parsed = parseLooseJson(raw, opts.schema);
      if (parsed.success) return parsed.data;
    }
    throw new LlmParseError();
  }

  async ping(): Promise<void> {
    await this.client.messages.countTokens({
      model: resolveModel(),
      messages: [{ role: "user" as const, content: "ping" }],
    });
  }
}

/**
 * Compat default is higher than the native 2048 because routed free models spend a
 * large share of the budget on `thinking` tokens before the visible answer;
 * callers passing an explicit `maxTokens` still win.
 */
const COMPAT_MAX_TOKENS = 8192;

/**
 * Tolerant JSON extraction for prompt-engineered structured outputs: strips markdown
 * fences and any prose around the outermost `{...}` before `JSON.parse` + zod.
 */
function parseLooseJson<T>(raw: string, schema: z.ZodType<T>): { success: true; data: T } | { success: false } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { success: false };
  try {
    const candidate: unknown = JSON.parse(raw.slice(start, end + 1));
    const result = schema.safeParse(candidate);
    return result.success ? { success: true, data: result.data } : { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * A base-URL override (`LLM_BASE_URL`) means a local OpenAI-compat router is
 * *configured* — see `CompatLlmClient`. Presence-only, deliberately: `getLlm()` also
 * checks `routerReachable()` before deciding which client to actually hand back, so this
 * function alone no longer says whether a given call is routed through the proxy.
 */
export function isCompatMode(): boolean {
  return Boolean(process.env.LLM_BASE_URL);
}

let cachedClient: LlmClient | null = null;

/**
 * Lazy singleton — throws `NoApiKeyError` if `ANTHROPIC_API_KEY` is unset so callers can
 * surface the keyless-mode Alert instead of crashing. `new Anthropic()` (zero-arg) would
 * read `ANTHROPIC_API_KEY` from `process.env` itself, which never sees a db-only key —
 * the key resolved via `getSecret` (db-first, env fallback) is passed explicitly instead.
 *
 * A valid key should work even when `LLM_BASE_URL` points at a 9router that isn't
 * actually running (03-feature-description.md §6): `isCompatMode()` is presence-only, so
 * it isn't enough on its own to decide the client. `routerReachable()` (already used by
 * Settings' 9router status panel) settles it — reachable: honor the proxy, same as
 * before; unreachable: fall through to the real Anthropic API directly instead of
 * handing back a client pointed at a dead address.
 *
 * ponytail: reachability is checked once per cache lifetime, not per call — if 9router
 * comes back up mid-session after a fallback, calls keep going direct until the next
 * `resetLlmClient()` (a secret save) or process restart. Upgrade path: re-check
 * `routerReachable()` on every call, or invalidate the cache on a timer, if that gap
 * ever matters in practice.
 */
export async function getLlm(): Promise<LlmClient> {
  if (!hasLlmKey()) throw new NoApiKeyError();
  if (!cachedClient) {
    const apiKey = getSecret("ANTHROPIC_API_KEY");
    const baseURL = process.env.LLM_BASE_URL;
    // routerReachable() already swallows its own errors and resolves false, but a
    // rejection here must never take getLlm() down with it -- treat one as unreachable.
    const useCompat = isCompatMode() ? await routerReachable().catch(() => false) : false;
    const anthropic = new Anthropic(useCompat && baseURL ? { apiKey, baseURL } : { apiKey });
    cachedClient = useCompat ? new CompatLlmClient(anthropic) : new AnthropicLlmClient(anthropic);
  }
  return cachedClient;
}

/**
 * Nulls the cached client so the next `getLlm()` call re-resolves the API key (and
 * compat-mode base URL) from scratch. Needed because a key change made through the
 * Settings UI must take effect immediately, without a server restart — without this,
 * a client cached against the old (or absent) key would keep serving forever.
 */
export function resetLlmClient(): void {
  cachedClient = null;
}

/**
 * Test-only constructor seam: wraps a caller-supplied (fake) Anthropic instance
 * instead of the real `new Anthropic()`, so service tests can inject a fake client with
 * zero live API calls. Bypasses `getLlm()`'s cache and the `ANTHROPIC_API_KEY` gate
 * entirely — tests exercise both keyed and keyless code paths without touching env.
 */
export function _createLlm(client: Anthropic): LlmClient {
  return new AnthropicLlmClient(client);
}

/** Test-only constructor seam for the compat-router client — same contract as `_createLlm`. */
export function _createCompatLlm(client: Anthropic): LlmClient {
  return new CompatLlmClient(client);
}
