import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

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
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
}

let cachedClient: LlmClient | null = null;

/**
 * Lazy singleton — throws `NoApiKeyError` if `ANTHROPIC_API_KEY` is unset so callers can
 * surface the keyless-mode Alert instead of crashing. `new Anthropic()` (zero-arg)
 * resolves credentials from the environment itself once a key is confirmed present.
 */
export function getLlm(): LlmClient {
  if (!hasLlmKey()) throw new NoApiKeyError();
  if (!cachedClient) cachedClient = new AnthropicLlmClient(new Anthropic());
  return cachedClient;
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
