# LLM client

The LLM client (`src/server/llm/client.ts`) is the one place the app reaches a language model. Remix (hooks, outline, script variants) and the idea generator call it for structured and free-text generation, and the Settings Test button and the dashboard health surfaces call it for connection checks. It serves the operator who adds an Anthropic API key in Settings. The agent-driven MCP flow does not use it, because there Claude or Codex is the reasoning brain and needs no key.

It exposes `generateText`, `generateParsed`, and `ping`, with two implementations. The native client talks to the Anthropic API with the SDK's structured output. The compat client talks through a local OpenAI-compatible router (9router) when `LLM_BASE_URL` is set and the router is reachable. A key is required on both paths.

## Data it holds

The layer writes nothing. It reads one row: `ANTHROPIC_API_KEY` from the `secrets` table (`src/server/db/schema.ts`, primary key `name`), through `getSecret` in `src/server/secrets/store.ts` (database first, environment fallback). The store is shared by all eight managed secrets. Callers persist results (idea row, remix session, run log).

Environment only: `CLAUDE_MODEL` (default `claude-sonnet-5`, via `resolveModel`) and `LLM_BASE_URL`.

## Boundaries

- Owns: `src/server/llm/` (`client.ts`, `schemas.ts`, `error-message.ts`, `generation-probe.ts`, `router-control.ts`).
- Called by: `services/remix.ts` (`generateParsed` for hooks and outline, `generateText` for script variants), `services/ideas.ts` (`generateParsed` with `IdeaSchema`), `actions/settings-actions.ts` (`ping` via `testAnthropicKeyAction`), `actions/router-actions.ts` (`probeLlmGeneration`), `actions/secrets-actions.ts` (`resetLlmClient`), and status components (`hasLlmKey`, `isRoutedThroughProxy`).
- Calls: the Anthropic API directly, or 9router through `LLM_BASE_URL`; `routerReachable` from `router-control.ts`.
- Not a consumer: `services/analyze.ts` imports only `VideoAnalysisSchema` to validate agent-authored analysis (`saveAgentAnalysis`). The layout schemas (`VideoLayoutSchema`, `asBeatLayout`) validate the frame-pass output and its export.
- Does not own: transcription (whisper.cpp or a network provider), Graph API metrics, or what a failure looks like on screen. Callers map `NoApiKeyError` and typed SDK errors to their own messages (`remix-actions.ts`, `settings-actions.ts`).

## Invariants

- No request without a key. `getLlm()` throws `NoApiKeyError` before any network call when no key resolves. Missing credential (nothing attempted) stays distinct from a failed attempt.
- Callers inject a fake client (`opts?.llm ?? (await getLlm())`), so service tests make no live calls. `_createLlm` and `_createCompatLlm` are test seams.
- The client is a cached singleton and `resetLlmClient()` drops it. Any secret change (`secrets-actions.ts`) calls it, so a key saved in Settings applies without a restart. The key is passed to the SDK constructor explicitly, since a zero-arg `new Anthropic()` reads only `process.env`.
- The compat client is chosen only when `LLM_BASE_URL` is set and `routerReachable()` is true (`isRoutedThroughProxy`). A configured but dead router falls back to the direct API. The check runs once per cache lifetime, so a router that comes back later is not used until the next reset or restart. `isCompatMode()` is presence only and must not be shown as "routed through proxy".
- `generateParsed` retries exactly once, and only on a null structured output. An HTTP error raises a typed SDK error and is never retried, so an auth failure does not become a second billed call. A second null throws `LlmParseError`.
- The compat path always streams and reads `finalMessage()`, because the router translates only the streaming wire format. It cannot use `output_config.format`, so it appends the JSON Schema to the system prompt and parses with `parseLooseJson` plus Zod. It defaults to 8192 `max_tokens` for routed models that spend budget on thinking; native defaults to 2048.
- No `temperature`, `top_p`, or `thinking` parameter is sent, because the default model rejects non-default sampling.
- `ping` is `messages.countTokens`: free, proves key validity and reachability only. In compat mode the router tokenizes locally, so a green ping does not prove generation. `probeLlmGeneration` runs ping and a one-word `generateText` (8 tokens) concurrently, each with its own timeout, and returns `up` (generated), `reachable_unverified` (ping only), or `down` (including no key).
- Script variants are per-slot isolated: `remix.ts` runs `Promise.allSettled` over N `generateText` calls, so one failed slot does not fail the rest.
- Every typed SDK error maps to a user string in one place, most specific first (`llmErrorMessage`). `NoApiKeyError` is deliberately not handled there because each call site words it for its feature.
- `router-control.ts` stops only the pid it started and does not sit on the request path.

## Where to look

- `src/server/llm/client.ts`: interface, both clients, `getLlm`, `resetLlmClient`, `isRoutedThroughProxy`.
- `src/server/llm/schemas.ts`: Zod contracts for hooks, outline, idea, analysis, and layout.
- `src/server/llm/generation-probe.ts`: the three-state health check.
- `src/server/llm/error-message.ts`: SDK error to message mapping.
- `src/server/secrets/store.ts`: key resolution.
- `src/server/services/remix.ts` and `ideas.ts`: the two generation callers.
