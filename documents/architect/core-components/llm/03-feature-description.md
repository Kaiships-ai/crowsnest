# llm: feature description

The llm layer has no screen of its own. Its "features" are the operations every AI
feature reaches it through — a structured or free-text generation, and a keyless
connection check — and what the user sees is owned by the callers (analyze, remix,
generate idea, the Settings API Keys card). This document describes those operations from
the layer's side: what a request does, how the two client modes differ, and what each
failure returns to the caller that surfaces it. It follows the same shape as the feature
documents so the set stays comparable; where a phase does not apply to a layer, it says so.

## Reach the model (a generation request)

### Summary

Every generation in the app — analyze's structured breakdown, remix's hooks, outline, and
script variants, and generate idea — calls the same client through
`getLlm()` (`src/server/llm/client.ts:232`). The client exposes two request methods:
`generateParsed` returns a value validated against a Zod schema, and `generateText`
returns plain text. Before any request is made, `getLlm()` throws `NoApiKeyError` if no
`ANTHROPIC_API_KEY` is resolvable, so a missing key never reaches the network. With a key,
the request runs against the real Anthropic API (native) or through a local
OpenAI-compatible router when `LLM_BASE_URL` is set (compat). The model is
`resolveModel()` — `claude-sonnet-5` unless `CLAUDE_MODEL` overrides it.

The layer owns the request, the one retry on a malformed structured output, and the
propagation of typed SDK errors. It does not own what a failure looks like: a caller
catches `NoApiKeyError` and the SDK's typed error classes and turns them into its own
surface — a block panel with the no-key or proxy-down reason in the remix studio, a key
alert in the analyze gate, a failed toast for generate idea. See
[external services](../../shared/external-services.md).

### The simple case

`analyze.ts` calls `client.generateParsed({ system: ANALYZE_SYSTEM, user, schema:
VideoAnalysisSchema })` (`src/server/services/analyze.ts:102`). On the native path the SDK
requests structured output via `output_config: { format: zodOutputFormat(schema) }`,
parses the response against the schema, and returns the typed value. The caller writes it
to a row and shows the result. `remix.ts` does the same for `HookOptionsSchema` and
`OutlineSchema`, and `generateText` for the three script variants
(`src/server/services/remix.ts:458`); `ideas.ts` calls `generateParsed` with
`IdeaSchema`. None of them constructs a client or names a model; they inject
`opts?.llm ?? getLlm()` so tests can pass a fake.

### The request, path by path

```
stateDiagram-v2
    [*] --> gate : caller calls getLlm()
    gate --> noKey : no ANTHROPIC_API_KEY (throw NoApiKeyError)
    gate --> native : key set, no LLM_BASE_URL
    gate --> compat : key set, LLM_BASE_URL set
    native --> ok : text / parsed_output returned
    native --> retry : parsed_output null (generateParsed)
    retry --> ok : second attempt parses
    retry --> parseFail : still null (throw LlmParseError)
    native --> sdkError : non-2xx (typed SDK error propagates)
    compat --> ok : streamed text / loose-parsed JSON
    compat --> compatRetry : JSON parse or Zod fails
    compatRetry --> ok : second attempt parses
    compatRetry --> parseFail : still fails (throw LlmParseError)
```

#### Before the request

`getLlm()` resolves the key through `getSecret` (db-first, env fallback) and picks the
client by `isCompatMode()`. If there is no key, it throws `NoApiKeyError` here, before any
network call — the caller has attempted nothing. The client is a cached singleton;
`resetLlmClient()` drops it so a key changed in Settings is picked up without a restart.

#### The native path

`generateText` calls `messages.create` and concatenates only text blocks.
`generateParsed` calls `messages.parse` and returns `parsed_output`. On a `null`
`parsed_output` — a refused or malformed structured output — it retries once, then throws
`LlmParseError`. A non-2xx failure raises a typed SDK error (`AuthenticationError`,
`RateLimitError`, `APIConnectionError`, or the base `APIError`) from `.parse()` itself and
is not retried. No sampling or thinking parameter is sent; `max_tokens` defaults to 2048.

#### The compat path

The router translates only the streaming wire format and ignores the structured-output
config, so this client always streams and reads `finalMessage()`. `generateParsed` appends
the JSON Schema to the system prompt and runs `parseLooseJson` — fence-strip, slice the
outermost `{...}`, `JSON.parse`, then Zod — with the same one-retry-then-`LlmParseError`
contract. `max_tokens` defaults to 8192 because routed models spend heavily on thinking
tokens before the answer.

#### What the caller gets back

On success, the typed value or text. On failure, one of two shapes the caller distinguishes:
`NoApiKeyError` (configuration, nothing attempted) or a typed SDK error (a real attempt
failed). `remix-actions.ts` maps the first to "Add ANTHROPIC_API_KEY in Settings to enable
remix generation." and the rest through `llmErrorMessage`
(`src/server/actions/remix-actions.ts:36`).

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Client mode | `LLM_BASE_URL` set at request time selects the compat client; unset selects native. Chosen when the singleton is first built. | Not changed mid-request. A base-URL change plus `resetLlmClient()` rebuilds the client on the next call. |
| Request method | `generateParsed` (schema-validated) for analyze, hooks, outline, ideas; `generateText` (plain) for script variants and the probe. | Fixed per call site. |
| Key presence | A resolvable key builds a client; no key throws `NoApiKeyError` before any request. | A key set in Settings takes effect on the next call because `resetLlmClient()` clears the cache. |
| Model | `CLAUDE_MODEL` env, else `claude-sonnet-5`. | Not per-request; the resolved name is recorded on the analysis row. |

### Cancel and interrupt

| Event | Before the request | While the request is in flight |
| --- | --- | --- |
| Explicit cancel or stop | Nothing has been sent. | The layer exposes no cancel; the SDK call runs to completion or its own timeout. The caller's trigger is disabled meanwhile. |
| A backing service fails | The key gate has already thrown `NoApiKeyError` if there is no credential. | A non-2xx or connection failure raises a typed SDK error the caller maps; `generateParsed` retries once only on a null structured output, not on an HTTP error. |
| Malformed model output | Not applicable. | `generateParsed` retries once, then throws `LlmParseError`; the caller reports a failed attempt and writes nothing partial. |
| Proxy down (compat) | If recent run rows show a connection error, the remix studio blocks the stage before the click. | A connection error surfaces as a typed `APIConnectionError`; nothing partial is written. |

### Interactions with other systems

**Persistence.** The layer writes nothing. Callers persist results (an analysis row, a
session field, a run-log row); a failed generation leaves no partial row.

**Configuration and settings.** The key is a managed secret set in Settings; `CLAUDE_MODEL`
and `LLM_BASE_URL` are env only. The key is db-first so a change applies without a restart.

**Status and failures.** The layer only throws; the run log, block panels, alerts, and
toasts belong to the callers. See [status and failures](../../shared/status-and-failures.md).

### Edge cases

- The only fully keyless path in the app is transcription (whisper.cpp), not this layer.
  Both native and compat require a key; `LLM_BASE_URL` changes routing, not the credential.
- `generateParsed` retries exactly once, and only on a null structured output, never on an
  HTTP error — an `AuthenticationError` is not retried into a second billed call.
- Script variants are per-slot isolated: `generateVariants` runs `Promise.allSettled` over
  N `generateText` calls, so one failed variant becomes `{ error }` at its slot and the
  call essentially never throws (`src/server/services/remix.ts:460`). Zero of N succeeding
  is what the run log records as a failed attempt.
- A re-analysis calls `generateParsed` again and overwrites only the text columns; the
  layer has no memory of a prior call and no notion of the layout columns it never produces.

## Check the connection (ping and the generation probe)

### Summary

The layer exposes two health checks that do not consume generation quota. `ping()` is a
`messages.countTokens` call — $0, no tokens generated — that succeeds iff the key is valid
and reachable. It backs the Settings API Keys "Test" button through
`testAnthropicKeyAction` (`src/server/actions/settings-actions.ts:96`). `probeLlmGeneration`
goes further: it runs `ping` and a real one-word `generateText` concurrently and reports
one of three states, because a passing ping alone does not prove the configured model
generates anything (`src/server/llm/generation-probe.ts`).

### The simple case

The user opens Settings, sets the Anthropic key, and clicks Test.
`testAnthropicKeyAction` calls `client.ping()`. On success the card shows the key as
working. On `NoApiKeyError` it returns "ANTHROPIC_API_KEY is not set."; any other error is
mapped by `llmErrorMessage`. No generation runs and nothing is billed.

### The three probe states

`probeLlmGeneration` classifies the pair of results:

- **up.** The one-word `generateText` returned non-empty text. The only state that proves
  the configured model actually generates — native or through the proxy.
- **reachable_unverified.** The ping got a response but generation did not. This is the
  honest state for a proxy whose `count_tokens` tokenizes locally while `/v1/messages`
  fails: reachable, but generation unproven.
- **down.** Neither answered, or `getLlm()` itself threw `NoApiKeyError` (no key means no
  usable LLM either way, reported as `down`).

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Key presence | No key makes `getLlm()` throw, reported as `down` by the probe and as "not set" by the Test button. | A key set then Test-clicked reflects the new key because `resetLlmClient()` cleared the cache. |
| Client mode | Native ping proves the real API; compat ping proves only the router answered, which is why the probe adds a real generation call. | The mode is fixed for the built client. |

### Cancel and interrupt

| Event | Answer |
| --- | --- |
| Explicit cancel | No cancel; each check is a single awaited call, each independently timed out in the probe. |
| A backing service fails | The check throws or times out; `testAnthropicKeyAction` maps the error, the probe returns `reachable_unverified` or `down`. Nothing is written and nothing is billed beyond the $0 `count_tokens`. |
| Timeout | The probe times each of ping and generation out separately, so the pair never takes longer than one call would; a timeout reads as a non-response. |

### Interactions with other systems

**Configuration and settings.** The Test button and the probe both resolve through the
same `getLlm()` and the same key, so a key that Tests green is the key generation will use.

**Status and failures.** `router-actions.ts` calls the probe to report the LLM's status
(`src/server/actions/router-actions.ts:112`); the Settings card reports the Test result.
Neither surface is owned by this layer.

### Edge cases

- `ping` costs $0 and consumes no generation quota, so the Test button can be pressed
  freely; it proves reachability and key validity, not that the model generates.
- In compat mode a green ping with a red generation is a real, distinct state
  (`reachable_unverified`) rather than a false "up", because the router can answer
  `count_tokens` locally and still 410 on generation.
