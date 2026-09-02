# llm: architecture

## Key files

- `src/server/llm/client.ts`: the whole layer. Defines the `LlmClient` interface
  (`generateText`, `generateParsed`, `ping`), its two implementations
  (`AnthropicLlmClient`, `CompatLlmClient`), the `NoApiKeyError` and `LlmParseError`
  classes, the model resolver (`resolveModel`, line 62), the key check (`hasLlmKey`), the
  compat-mode check (`isCompatMode`, line 219), the lazy singleton (`getLlm`, line 232),
  and the cache reset (`resetLlmClient`, line 249). Nothing else constructs an Anthropic
  client.
- `src/server/llm/schemas.ts`: the Zod schemas every structured call validates against —
  `VideoAnalysisSchema` (analyze), `HookOptionsSchema`, `OutlineSchema`, `IdeaSchema`
  (remix and ideas), plus the layout schemas the not-yet-wired frame pass will use. These
  are the enforced contract; the prompts describe the same shape in prose.
- `src/server/llm/error-message.ts`: `llmErrorMessage`, the one place the typed
  `@anthropic-ai/sdk` error hierarchy is mapped to a user-facing string. Checked
  most-specific-first: `AuthenticationError`, then `RateLimitError`, then
  `APIConnectionError`, then the base `APIError`.
- `src/server/llm/generation-probe.ts`: `probeLlmGeneration`, the health check that
  actually calls `generateText` (a one-word prompt, `maxTokens: 8`) rather than only
  pinging, and classifies the result into `up`, `reachable_unverified`, or `down`.
- `src/server/llm/router-control.ts`: the process supervisor for the local 9router proxy
  (start, track by pid, stop only the pid it started, reachability probe). Not part of the
  request path — it manages the proxy the compat client talks to.
- `src/server/secrets/store.ts`: `getSecret` (db-first, env fallback) resolves the API
  key. A key set through Settings takes effect without a restart because the db row wins.
- Callers, one directory out: `src/server/services/analyze.ts`,
  `src/server/services/remix.ts`, `src/server/services/ideas.ts` invoke the client;
  `src/server/actions/settings-actions.ts` and `src/server/actions/router-actions.ts`
  drive `ping` and the probe.

## Data flow

**Which client is built.** `getLlm()` throws `NoApiKeyError` immediately if no key is
resolvable, so no request is ever attempted without a credential. With a key it constructs
a single Anthropic instance and wraps it: `CompatLlmClient` when `LLM_BASE_URL` is set
(`isCompatMode()`), `AnthropicLlmClient` otherwise. The instance is cached as a
module-level singleton; `resetLlmClient()` nulls it so the next call re-resolves the key
and base URL from scratch. The key comes from `getSecret("ANTHROPIC_API_KEY")` and is
passed explicitly to the constructor — a zero-arg `new Anthropic()` would read only
`process.env` and never see a db-only key. `LLM_BASE_URL` is not a managed secret, so it
is read straight from the env.

**Which model.** `resolveModel()` returns `process.env.CLAUDE_MODEL ?? "claude-sonnet-5"`.
The default is `claude-sonnet-5` (Sonnet 5: 1M context, verified against the claude-api
skill as the cheapest of the Sonnet/Opus tier at $2 / $10 per 1M input/output). The
resolver is exported so a caller that persists which model produced a result —
`analyze.ts` writes `model: resolveModel()` onto the `video_analyses` row (line 117) —
reuses the same logic rather than re-deriving it.

**The native path (`AnthropicLlmClient`).** `generateText` calls `messages.create` and
concatenates only `type === "text"` blocks. `generateParsed` calls `messages.parse` with
`output_config: { format: zodOutputFormat(schema) }` — the SDK's native structured-output
support — and returns `response.parsed_output`. On a `null` parsed output it retries once,
then throws `LlmParseError`; a non-2xx failure raises a typed SDK error from `.parse()`
itself and is not retried. No `temperature`, `top_p`, or `thinking` parameter is sent:
Sonnet 5 rejects non-default sampling params, and omitting `thinking` runs adaptive
thinking, which is already the default. `max_tokens` defaults to 2048.

**The compat path (`CompatLlmClient`).** A local OpenAI-compatible router (9router) at
`LLM_BASE_URL` translates the Anthropic *streaming* wire format but not the non-streaming
one, and ignores `output_config.format` because the free backing models have no structured
output support. So this client always streams and reads the result via `finalMessage()`,
and implements `generateParsed` as prompt-engineered JSON: the JSON Schema is appended to
the system prompt, and `parseLooseJson` strips markdown fences and any prose around the
outermost `{...}` before `JSON.parse` and Zod validation — same one-retry-then-`LlmParseError`
contract as the native path. Its default `max_tokens` is 8192, higher than native because
routed models spend a large share of the budget on `thinking` tokens.

**The key check (`ping`).** Both clients implement `ping` as a `messages.countTokens`
call, which costs $0 and consumes no generation quota. It succeeds iff the key is valid and
reachable, and throws the same typed SDK errors otherwise. It backs the Settings "Test"
button (`testAnthropicKeyAction`).

**The generation probe.** `probeLlmGeneration` runs `ping` and a real `generateText`
concurrently, each independently timed out. Non-empty generated text means `up` (the only
state that proves the configured model actually generates); a passing ping with failed
generation means `reachable_unverified`; neither answering means `down`. This exists
because in compat mode a passing `count_tokens` (tokenized locally by the router) does not
prove `/v1/messages` works — the router can 410 for the same model.

## Decisions

- **One client interface, two implementations, picked at runtime by `LLM_BASE_URL`.**
  Callers inject a fake `LlmClient` in tests (`opts?.llm ?? getLlm()`), so every service
  test runs with zero live API calls. Neither caller knows or cares which real client is
  behind the interface.
- **The key gate lives in the layer, not in every caller.** `getLlm()` throws
  `NoApiKeyError` before any request, so the distinction between "no credential, nothing
  attempted" and "credential present, request failed" is held in one place. A missing key
  is a configuration state; a reachable key with an unreachable proxy is a connection
  failure after a real attempt. Callers map the two to different user-facing surfaces (a
  block panel reason in remix, a key alert in analyze) via `llmErrorMessage`.
- **Structured output is native where it can be and prompt-engineered where it cannot.**
  The native path trusts the SDK's `zodOutputFormat`; the compat path cannot, because the
  router drops `output_config.format`, so it asks for JSON in the system prompt and parses
  by hand. Both keep the identical one-retry-then-fail contract so callers see the same
  `LlmParseError` regardless of route.
- **The key is resolved through the secret store, not the env alone.** `getSecret` is
  db-first so a key entered in Settings takes effect immediately; `resetLlmClient()`
  (called from `secrets-actions.ts` on any key change) drops the cached client so the new
  key is picked up without a server restart.
- **A key is required on both paths.** `LLM_BASE_URL` only changes where the request is
  routed, not whether a key is needed. There is no fully keyless path through this layer
  the way there is for local transcription (whisper.cpp).
- **The layer owns the request and the retry; callers own the failure.** It does not
  decide what a failure looks like on screen, does not own transcription, and does not own
  the Graph API metrics — those are separate external dependencies with their own failure
  surfaces (see `../../shared/external-services.md`).

## Open, not verified end to end

Per `../../shared/packaging-and-release.md`: the no-proxy path — a real Kit install
talking straight to the Anthropic API with its default model, no local router in front of
it — has not been proven to complete a live analysis or remix generation end to end with
real credentials. `kai kit init` also has a live bug that affects this layer's one input:
the `ANTHROPIC_API_KEY` prompt is meant to be masked (`ask({ secret: true })`,
`src/cli/kai.ts:151`) but echoes the key in plaintext on a real TTY, landing it in
terminal scrollback (`evidence/10-onboarding-bugs.md`, BUG 2).
