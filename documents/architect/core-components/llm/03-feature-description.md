# llm: feature description

The llm layer has no screen of its own. Its features are the operations every AI feature reaches it through, a structured or free-text generation, and a keyless connection check, and what the user sees is owned by the callers: remix, generate idea, and the Settings API Keys card. This document describes those operations from the layer's own side: what a request does, how the two client modes differ, and what each failure returns to the caller that surfaces it.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Reach the model (a generation request) | A structured or free-text call to Claude, native or through a local compat router | ● | `src/server/llm/client.ts` (`getLlm`, `generateText`, `generateParsed`) | none |
| 3 | Check the connection (ping and the generation probe) | A zero-cost key check, plus a real one-word generation to prove the model actually answers | ● | `src/server/llm/client.ts` (`ping`), `src/server/llm/generation-probe.ts` | none |
|  | Structured layout reads (frame pass) | A per-beat visual reading (on-screen text, animation, cursor, tool, text position, voice pace) from sampled frames | ○ | `src/server/llm/schemas.ts` (`VideoLayoutSchema`) | roadmap, no frame pass wired up yet |

## 2. Reach the model (a generation request)

### Who uses it

Every in-app generation: remix's hooks, outline, and script variants, and generate idea. Each caller reaches this feature through the same client, injected as `opts?.llm ?? getLlm()` so tests can pass a fake.

### What it does

The client exposes two request methods: `generateParsed` returns a value validated against a Zod schema, and `generateText` returns plain text. Before any request is made, `getLlm()` throws `NoApiKeyError` if no `ANTHROPIC_API_KEY` is resolvable, so a missing key never reaches the network. With a key, the request runs against the real Anthropic API (native) or through a local OpenAI-compatible router when `LLM_BASE_URL` is set (compat). The model is `resolveModel()`, `claude-sonnet-5` unless `CLAUDE_MODEL` overrides it.

On the native path, `generateText` calls `messages.create` and concatenates only text blocks; `generateParsed` calls `messages.parse` and returns `parsed_output`. On a `null` `parsed_output`, a refused or malformed structured output, it retries once, then throws `LlmParseError`. A non-2xx failure raises a typed SDK error (`AuthenticationError`, `RateLimitError`, `APIConnectionError`, or the base `APIError`) from `.parse()` itself and is not retried. No sampling or thinking parameter is sent; `max_tokens` defaults to 2048.

On the compat path, the router translates only the streaming wire format and ignores the structured-output config, so this client always streams and reads `finalMessage()`. `generateParsed` appends the JSON Schema to the system prompt and runs `parseLooseJson`, fence-strip, slice the outermost `{...}`, `JSON.parse`, then Zod, with the same one-retry-then-`LlmParseError` contract. `max_tokens` defaults to 8192 because routed models spend heavily on thinking tokens before the answer.

### How to access it

Every caller reaches this feature through `getLlm()` (`src/server/llm/client.ts`). `remix.ts` calls `generateParsed` for `HookOptionsSchema` and `OutlineSchema`, and `generateText` for the script variants. `ideas.ts` calls `generateParsed` with `IdeaSchema`. Neither constructs a client or names a model directly.

### Business rules

- `getLlm()` resolves the key through `getSecret` (database first, environment fallback) and picks the client by `isCompatMode()`. If there is no key, it throws `NoApiKeyError` here, before any network call; the caller has attempted nothing.
- The client is a cached singleton; `resetLlmClient()` drops it so a key changed in Settings is picked up on the next call without a restart.
- `generateParsed` retries exactly once, and only on a null structured output, never on an HTTP error; an `AuthenticationError` is not retried into a second billed call.
- Script variants are per-slot isolated: `generateVariants` runs `Promise.allSettled` over N `generateText` calls, so one failed variant becomes an error at its slot and the call essentially never throws; zero of N succeeding is what the caller's run log records as a failed attempt.

### Limitations

- The layer exposes no cancel; a request runs to completion or its own timeout, and the caller's trigger is disabled meanwhile.
- The only fully keyless path in the app is transcription (whisper.cpp), not this layer. Both native and compat require a key; `LLM_BASE_URL` changes routing, not the credential.
- On success the caller gets the typed value or text; on failure, one of two shapes it distinguishes: `NoApiKeyError` (configuration, nothing attempted) or a typed SDK error (a real attempt failed). `remix-actions.ts` maps the first to "Add ANTHROPIC_API_KEY in Settings to enable remix generation." and the rest through `llmErrorMessage`.

### User guide

The llm layer has no screen of its own, so there is nothing to walk through here directly. What a generation looks like to the user, the remix hook and outline cards, the script variant slots, and the generated idea, is documented in each caller's own user guide. What is true everywhere those surfaces reach this layer: a missing Anthropic key shows as a message inviting you to add it in Settings, and a real attempt that fails shows a different message naming the problem, so you can tell "nothing was tried" from "something went wrong" at a glance.

## 3. Check the connection (ping and the generation probe)

### Who uses it

The user, from the Settings API Keys card's Test button, and the app itself, through the router status check that reports the LLM's health.

### What it does

The layer exposes two health checks that do not consume generation quota. `ping()` is a `messages.countTokens` call, costing nothing, generating no tokens, that succeeds only if the key is valid and reachable. `probeLlmGeneration` goes further: it runs `ping` and a real one-word `generateText` concurrently and reports one of three states, because a passing ping alone does not prove the configured model generates anything.

`probeLlmGeneration` classifies the pair of results:

- **up.** The one-word `generateText` returned non-empty text. The only state that proves the configured model actually generates, native or through the proxy.
- **reachable_unverified.** The ping got a response but generation did not. This is the honest state for a proxy whose `count_tokens` tokenizes locally while `/v1/messages` fails: reachable, but generation unproven.
- **down.** Neither answered, or `getLlm()` itself threw `NoApiKeyError`; no key means no usable LLM either way, reported as `down`.

### How to access it

`testAnthropicKeyAction` (`src/server/actions/settings-actions.ts`) calls `client.ping()` for the Settings Test button. `router-actions.ts` calls `probeLlmGeneration` to report the LLM's status on the router status surface.

### Business rules

- No key makes `getLlm()` throw, reported as `down` by the probe and as "ANTHROPIC_API_KEY is not set." by the Test button.
- A key set then Test-clicked reflects the new key immediately, because `resetLlmClient()` cleared the cache.
- The probe times ping and generation independently, so the pair never takes longer than one call would.
- A native ping proves the real API is reachable; a compat ping proves only that the router answered, which is why the probe adds a real generation call rather than trusting `ping` alone in compat mode.

### Limitations

- `ping` proves reachability and key validity, not that the model generates; only `probeLlmGeneration`'s `up` state proves generation.
- Neither check can be cancelled once started; each is a single awaited call, independently timed out inside the probe.

### User guide

Open Settings, find the API Keys card, and click Test next to Anthropic. The card tells you whether the key works, without generating any text or costing anything to check. If the key is missing, it says so instead of running the test. Elsewhere in the app, the same underlying check backs the LLM status indicator: a working model reads as available, a router that answers but cannot generate reads as unverified, and nothing answering reads as unavailable.

## 4. Interactions with other systems

**Persistence.** The layer writes nothing. Callers persist results, an idea row, a session field, a run-log row; a failed generation leaves no partial row.

**Configuration and settings.** The key is a managed secret set in Settings; `CLAUDE_MODEL` and `LLM_BASE_URL` are environment only. The key is database first, so a change applies without a restart.

**Status and failures.** The layer only throws; the run log, block panels, alerts, and the Test button belong to the callers. See [status and failures](../../shared/status-and-failures.md) and [external services](../../shared/external-services.md).

## 5. Edge cases

- The only fully keyless path in the app is transcription (whisper.cpp), not this layer. Both native and compat require a key; `LLM_BASE_URL` changes routing, not the credential.
- `generateParsed` retries exactly once, and only on a null structured output, never on an HTTP error.
- Script variants are per-slot isolated, so one failed variant does not fail the others; zero of N succeeding is the failed-attempt fact the caller's run log records.
- In compat mode a green ping with a red generation is a real, distinct state (`reachable_unverified`) rather than a false "up", because the router can answer `count_tokens` locally and still fail generation for the same model.
