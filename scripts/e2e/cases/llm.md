# LLM client cases

## Built features

The LLM client has no screen of its own. Its features are the operations every AI feature reaches it through, a structured or free-text generation and a keyless connection check, and what the user sees is owned by the callers: remix, generate idea, and the Settings API Keys card.

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Reach the model (a generation request) | A structured or free-text call to Claude, native or through a local compat router | ● | `src/server/llm/client.ts` (`getLlm`, `generateText`, `generateParsed`) | none |
| 3 | Check the connection (ping and the generation probe) | A zero-cost key check, plus a real one-word generation to prove the model actually answers | ● | `src/server/llm/client.ts` (`ping`), `src/server/llm/generation-probe.ts` | none |
|  | Structured layout reads (frame pass) | A per-beat visual reading (on-screen text, animation, cursor, tool, text position, voice pace) from sampled frames | ◐ | `src/server/llm/schemas.ts` (`VideoLayoutSchema`), `src/server/services/frame-pass.ts` | frame pass service and export exist; no model call goes through the client |

### Reach the model (a generation request)

#### Who uses it

Every in-app generation: remix's hooks, outline, and script variants, and generate idea. Each caller reaches this feature through the same client, injected as `opts?.llm ?? getLlm()` so tests can pass a fake.

#### What it does

The client exposes two request methods: `generateParsed` returns a value validated against a Zod schema, and `generateText` returns plain text. Before any request is made, `getLlm()` throws `NoApiKeyError` if no `ANTHROPIC_API_KEY` is resolvable, so a missing key never reaches the network. With a key, the request runs against the real Anthropic API (native) or, when `LLM_BASE_URL` is set and the router answers, through a local OpenAI-compatible router (compat). A configured but unreachable router falls back to the direct API. The model is `resolveModel()`, `claude-sonnet-5` unless `CLAUDE_MODEL` overrides it.

On the native path, `generateText` calls `messages.create` and concatenates only text blocks; `generateParsed` calls `messages.parse` and returns `parsed_output`. On a `null` `parsed_output`, a refused or malformed structured output, it retries once, then throws `LlmParseError`. A non-2xx failure raises a typed SDK error (`AuthenticationError`, `RateLimitError`, `APIConnectionError`, or the base `APIError`) from `.parse()` itself and is not retried. No sampling or thinking parameter is sent; `max_tokens` defaults to 2048.

On the compat path, the router translates only the streaming wire format and ignores the structured-output config, so this client always streams and reads `finalMessage()`. `generateParsed` appends the JSON Schema to the system prompt and runs `parseLooseJson`, fence-strip, slice the outermost `{...}`, `JSON.parse`, then Zod, with the same one-retry-then-`LlmParseError` contract. `max_tokens` defaults to 8192 because routed models spend heavily on thinking tokens before the answer.

#### How to access it

Every caller reaches this feature through `await getLlm()` (`src/server/llm/client.ts`). `remix.ts` calls `generateParsed` for `HookOptionsSchema` and `OutlineSchema`, and `generateText` for the script variants. `ideas.ts` calls `generateParsed` with `IdeaSchema`. Neither constructs a client or names a model directly.

#### Business rules

- `getLlm()` resolves the key through `getSecret` (database first, environment fallback) and picks the client by `isRoutedThroughProxy()` (`LLM_BASE_URL` set and the router reachable). If there is no key, it throws `NoApiKeyError` here, before any network call; the caller has attempted nothing.
- The client is a cached singleton; `resetLlmClient()` drops it so a key changed in Settings is picked up on the next call without a restart.
- `generateParsed` retries exactly once, and only on a null structured output, never on an HTTP error; an `AuthenticationError` is not retried into a second billed call.
- Script variants are per-slot isolated: `generateVariants` runs `Promise.allSettled` over N `generateText` calls, so one failed variant becomes an error at its slot and the call essentially never throws; zero of N succeeding is what the caller's run log records as a failed attempt.

#### Limitations

- The layer exposes no cancel; a request runs to completion or its own timeout, and the caller's trigger is disabled meanwhile.
- The only fully keyless path in the app is transcription (whisper.cpp), not this layer. Both native and compat require a key; `LLM_BASE_URL` changes routing, not the credential.
- On success the caller gets the typed value or text; on failure, one of two shapes it distinguishes: `NoApiKeyError` (configuration, nothing attempted) or a typed SDK error (a real attempt failed). `remix-actions.ts` maps the first to "Add ANTHROPIC_API_KEY in Settings to enable remix generation." and the rest through `llmErrorMessage`.

#### User guide

The llm layer has no screen of its own, so there is nothing to walk through here directly. What a generation looks like to the user, the remix hook and outline cards, the script variant slots, and the generated idea, is documented in each caller's own user guide. What is true everywhere those surfaces reach this layer: a missing Anthropic key shows as a message inviting you to add it in Settings, and a real attempt that fails shows a different message naming the problem, so you can tell "nothing was tried" from "something went wrong" at a glance.

### Check the connection (ping and the generation probe)

#### Who uses it

The user, from the Settings API Keys card's Test button, and the app itself, through the router status check that reports the LLM's health.

#### What it does

The layer exposes two health checks that do not consume generation quota. `ping()` is a `messages.countTokens` call, costing nothing, generating no tokens, that succeeds only if the key is valid and reachable. `probeLlmGeneration` goes further: it runs `ping` and a real one-word `generateText` concurrently and reports one of three states, because a passing ping alone does not prove the configured model generates anything.

`probeLlmGeneration` classifies the pair of results:

- **up.** The one-word `generateText` returned non-empty text. The only state that proves the configured model actually generates, native or through the proxy.
- **reachable_unverified.** The ping got a response but generation did not. This is the honest state for a proxy whose `count_tokens` tokenizes locally while `/v1/messages` fails: reachable, but generation unproven.
- **down.** Neither answered, or `getLlm()` itself threw `NoApiKeyError`; no key means no usable LLM either way, reported as `down`.

#### How to access it

`testAnthropicKeyAction` (`src/server/actions/settings-actions.ts`) calls `client.ping()` for the Settings Test button. `router-actions.ts` calls `probeLlmGeneration` to report the LLM's status on the router status surface.

#### Business rules

- No key makes `getLlm()` throw, reported as `down` by the probe and as "ANTHROPIC_API_KEY is not set." by the Test button.
- A key set then Test-clicked reflects the new key immediately, because `resetLlmClient()` cleared the cache.
- The probe times ping and generation independently, so the pair never takes longer than one call would.
- A native ping proves the real API is reachable; a compat ping proves only that the router answered, which is why the probe adds a real generation call rather than trusting `ping` alone in compat mode.

#### Limitations

- `ping` proves reachability and key validity, not that the model generates; only `probeLlmGeneration`'s `up` state proves generation.
- Neither check can be cancelled once started; each is a single awaited call, independently timed out inside the probe.

#### User guide

Open Settings, find the API Keys card, and click Test next to Anthropic. The card tells you whether the key works, without generating any text or costing anything to check. If the key is missing, it says so instead of running the test. Elsewhere in the app, the same underlying check backs the LLM status indicator: a working model reads as available, a router that answers but cannot generate reads as unverified, and nothing answering reads as unavailable.

### Edge cases

- The only fully keyless path in the app is transcription (whisper.cpp), not this layer. Both native and compat require a key; `LLM_BASE_URL` changes routing, not the credential.
- `generateParsed` retries exactly once, and only on a null structured output, never on an HTTP error.
- Script variants are per-slot isolated, so one failed variant does not fail the others; zero of N succeeding is the failed-attempt fact the caller's run log records.
- In compat mode a green ping with a red generation is a real, distinct state (`reachable_unverified`) rather than a false "up", because the router can answer `count_tokens` locally and still fail generation for the same model.

## llm: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

Retired (P0 slice 2a): the in-app analyze path. `analyze.ts` no longer calls this layer; analysis is now authored by an external agent through `crowsnest_save_analysis` (keyless) and validated against `VideoAnalysisSchema`, not generated here. The cases that drove the removed in-app Analyze and Re-analyze buttons and the model-write path are retired: BEH-01, BEH-07, ACTION-06, and E2E-07. BEH-02 and E2E-02, the native structured-call happy path, are repointed to a remix generation stage. The layer's own mechanics (the one retry, loose-JSON parse, error mapping, the generation probe) and its live callers (remix, the ideas loop, and the health surfaces) are unchanged.

How to run these: the llm layer has no screen of its own, so most cases are verified through the surfaces that call it. Start the dev server and open `http://localhost:3001` (never `127.0.0.1`), on a database with at least one tracked channel that has finished a sync and at least one video with a saved analysis (written through `crowsnest_save_analysis`), since remix and the ideas loop read that analysis row. Toggle the two llm inputs independently: set or unset `ANTHROPIC_API_KEY` (unset for the no-key state), and set or unset `LLM_BASE_URL` to a local 9router (unset for the native path, set for the compat path). A key set through the Settings API Keys card lands in the database and wins over the environment. The layer's code-level behavior (retry, loose-JSON parse, error mapping, probe timing) is covered by `src/server/llm/client.test.ts`, `error-message.test.ts`, and `generation-probe.test.ts`, run with `vitest`, temporary SQLite database.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BEH-02 | P1 | key, native | A native structured call returns a schema-valid result via `messages.parse` and `zodOutputFormat` ([reach the model](#reach-the-model-a-generation-request)). | `ANTHROPIC_API_KEY` set, `LLM_BASE_URL` unset, a remix session open at the hooks stage. | 1. Run the hooks generation. | Hooks come back validated against `HookOptionsSchema` and render in the stage, proving one native structured call landed. | 🟡 no LLM key |
| BEH-03 | P1 | key, compat | On the compat path the client streams and parses prompt-engineered JSON, the same one-retry-then-fail contract as native ([reach the model](#reach-the-model-a-generation-request)). | `ANTHROPIC_API_KEY` set and `LLM_BASE_URL` pointed at a running 9router. | 1. Run a remix hook or outline generation. | Hooks or outline come back parsed and schema-valid even though the router drops `output_config.format`; a malformed reply retries once then fails. | 🟡 no LLM key |
| BEH-04 | P1 | key change | A key set through Settings takes effect without a restart, because `resetLlmClient()` drops the cached client ([reach the model](#reach-the-model-a-generation-request)). | Start with no key, LLM features blocked. | 1. Paste the key in Settings and save.<br>2. Without restarting, run a generation. | The generation runs against the just-saved key; no server restart needed. | 🟢 pass (browser): pasted a test key into Settings, Save persisted it ("Anthropic API key saved.", state flipped Not set to Configured), then clicking Test immediately (same server process, no restart) returned "Anthropic API key: connection OK" instead of the no-key state, confirming `resetLlmClient()` picked up the new key right away. Key cleared afterward to restore the no-key baseline for the rest of this pass (see test-shots/llm/BEH-04.png) |
| BEH-05 | P1 | proxy or key | The layer distinguishes no key (nothing attempted) from a proxy or SDK failure (a real attempt failed), and the two surfaces read differently ([reach the model](#reach-the-model-a-generation-request)). | Two states: (a) key unset; (b) key set but `LLM_BASE_URL` pointed at a stopped router. | 1. In state (a) try a remix generation.<br>2. In state (b) try one. | (a) block panel names the missing key. (b) block panel names the proxy down, a connection error. The two read differently. | 🟡 no LLM key |
| BEH-06 | P2 | key, compat | Script variants are per-slot isolated: one failed variant shows an inline error at its slot without failing the others ([reach the model](#reach-the-model-a-generation-request)). | A remix at the script stage, a key set. | 1. Generate variants with the model reachable, then force one slot to fail. | Failed slots show an inline error; the others still land; the run log records the attempt, partial when some succeeded and failed when none did. | 🟡 no LLM key |
| BEH-08 | P1 | key | The Settings Test button calls `ping()`, a zero-cost call, and reports whether the key is valid and reachable ([check the connection](#check-the-connection-ping-and-the-generation-probe)). | A key set. | 1. Open Settings, API Keys, click Test on Anthropic. | The card reports the key working; no generation is billed. With the key unset it reports "ANTHROPIC_API_KEY is not set." | 🟡 no LLM key |
| BEH-09 | P1 | key, compat | The generation probe reports up only when a real one-word generation returns text; reachable-unverified when the ping passes but generation does not; down when neither answers ([check the connection](#check-the-connection-ping-and-the-generation-probe)). | Three states: native key working; compat router that answers `count_tokens` but fails generation; router stopped. | 1. Check the LLM status indicator in each state. | Working native shows up. Router that pings but cannot generate shows reachable-unverified. Nothing answering (or no key) shows down. | 🟡 no LLM key (current env's middle state observed: badge reads "9router: Reachable, generation unverified" with 9router up and no key, consistent with reachable-unverified; the up and down states need a key and a stopped router respectively) |

Retired (P0 slice 2a, the in-app Analyze and Re-analyze buttons no longer exist): BEH-01 (the no-key alert on the Analyze button; the remix no-key block panel it also asserted stays covered by BEH-05) and BEH-07 (in-app re-analysis and the `ReanalyzeButton` `hasKey` gate). Analysis is agent-authored through `crowsnest_save_analysis` and needs no key, so there is no in-app analyze surface left to drive.

Not checkable by hand:

- Whether `messages.parse` actually issues a second HTTP call on the one retry, versus the SDK short-circuiting, observable only at the network layer or in `client.test.ts`.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | server action (`src/server/actions/remix-actions.ts`) | `NoApiKeyError` maps to "Add ANTHROPIC_API_KEY in Settings to enable remix generation.", every other error maps through `llmErrorMessage`. | No key configured. | Call a remix generation action with no key set. | The result names the missing key with the remix-specific message, not the generic `llmErrorMessage` string. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | unit test (`src/server/llm/client.test.ts`) | `generateParsed` retries exactly once on a null `parsed_output`, then throws `LlmParseError`; a non-2xx SDK error is not retried. | Fake `Anthropic` client stub. | Run the `client.test.ts` cases for the retry and the typed-error propagation. | A null structured output retries once then raises `LlmParseError`; an SDK error propagates untouched with no second call. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | unit test (`src/server/llm/client.test.ts`) | On the compat path, `parseLooseJson` strips markdown fences and slices the outermost `{...}` before `JSON.parse` and Zod validation. | Fake streamed responses with fences and surrounding prose. | Run the compat-path parsing cases in `client.test.ts`. | Fenced or prose-wrapped JSON parses to a schema-valid value; malformed JSON fails and triggers the one retry. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | unit test (`src/server/llm/error-message.test.ts`) | `llmErrorMessage` maps the typed SDK hierarchy most-specific-first (`AuthenticationError`, `RateLimitError`, `APIConnectionError`, then the base `APIError`); `NoApiKeyError` is not handled by this helper. | Fake typed SDK errors. | Run the `error-message.test.ts` cases. | Each typed error maps to its friendly string; the base `APIError` catch stands in last; `NoApiKeyError` is not handled here. | 🟢 covered by vitest (green) |
| ACTION-05 | P2 | unit test (`src/server/llm/generation-probe.test.ts`) | The probe times ping and generation independently, so the pair never takes longer than one call, and a `NoApiKeyError` from `getLlm()` is caught and reported as down rather than thrown. | Fake `LlmClient` with controllable timing and failure. | Run the `generation-probe.test.ts` cases. | Each half is timed out separately; a missing key resolves to `down` with its message rather than throwing. | 🟢 covered by vitest (green) |
| ACTION-07 | P2 | server action (`src/server/services/remix.ts`) | `generateVariants` runs `Promise.allSettled` over N `generateText` calls, so one rejected promise becomes an error at its slot and the call does not throw. | A fake `LlmClient` where one of N `generateText` calls rejects. | `generateVariants(sessionId, { llm: fakeClient })`. | The settled results array has N entries; the failed slot carries an error object, the others carry the generated text; no exception propagates. | 🟢 covered by vitest (green) |

Retired (P0 slice 2a): ACTION-06, which asserted `analyzeVideo` wrote `resolveModel()` onto the `video_analyses.model` column. That caller is gone, no current caller persists the model id, and `resolveModel` is now internal to `client.ts` (called on every request to name the model). The `video_analyses.model` column still exists in the schema but nothing writes it; `saveAgentAnalysis` omits it.

Not checkable by hand:

- Whether a compat-mode `count_tokens` really tokenizes locally while `/v1/messages` fails for the same model, which is the premise of the `reachable_unverified` state.
- The exact wording a live `AuthenticationError` versus `RateLimitError` produces, without inducing each real error against the Anthropic API.

## 3. browse-e2e

The llm layer has no screen of its own, so its journeys drive the two surfaces that call it directly: the Settings API keys card's Anthropic Test button (feature 3's `ping`) and the 9router supervisor section (feature 3's generation probe), plus a remix generation stage, the caller surface that reaches feature 2. Every built feature in the `03` summary has a happy-path journey below: feature 2 (E2E-02) and feature 3 (E2E-01). The `Structured layout reads` frame pass is `○` roadmap, so it needs none.

Corner-case types marked not applicable for this layer:

- `empty`: the layer holds no data of its own and renders no zero-data list, so there is no empty state it owns; a caller's empty feed is that caller's case.
- `boundary`: the layer exposes no user-facing count, page size, or cap; `max_tokens` (2048 native, 8192 compat) is an internal default with no UI edge to sit at.
- `invalid`: the layer validates model output (retry then `LlmParseError`), not user input; the only text field on any surface here is the masked key input, owned by the secrets and settings component, not this layer.
- `stale`: the layer is stateless and writes nothing, so there is no optimistic UI or reload-reconciliation window it owns; a key set in Settings applies on the next call via `resetLlmClient()` with no intermediate state a user reads.

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 3 | happy | live | Test the Anthropic key from the Settings API keys card | Dev server up, a valid `ANTHROPIC_API_KEY` configured (env or set via the card so `secrets-anthropic-api-key-badge` reads "Configured"), `/settings` open on the API keys section. | Arrive on `/settings`; Act: click `data-testid="secrets-anthropic-api-key-test"` | A success toast reads "Anthropic API key: connection OK" (`assert_text`); `data-testid="secrets-anthropic-api-key-badge"` stays "Configured"; no generation is billed (a `ping`, `messages.countTokens`, only). | none | 🟡 no LLM key |
| E2E-02 | P1 | 2 | happy | live | Generate remix hooks and see the structured result land | Valid `ANTHROPIC_API_KEY` set, `LLM_BASE_URL` unset (native), a remix session open at the hooks stage. Setup gap: the "Generate hooks" trigger in `stage-hook.tsx` carries no `data-testid` yet (only `remix-hook-seed-select` exists), so this journey is blocked on adding one, tracked with remix's own browse-e2e. | Arrive on the remix hooks stage; Act: click the "Generate hooks" trigger (no testid yet) | The stage renders 3-7 hook drafts validated against `HookOptionsSchema`, proving one native structured call landed. | none | 🟡 no LLM key (also the generate-hooks trigger has no testid yet) |
| E2E-03 | P1 | 3 | auth | offline | No key configured: the Anthropic gate refuses without attempting a call | Seeded fixture database, `ANTHROPIC_API_KEY` unset in both `.env.local` and the database, `/settings` open on the API keys section. | Arrive on `/settings`; Act: read the Anthropic row (its Test control cannot be clicked) | `data-testid="secrets-anthropic-api-key-badge"` reads "Not set"; `data-testid="secrets-anthropic-api-key-test"` is present but disabled, so no `ping` is attempted. | `scripts/e2e/llm-e2e-03.sh` | 🟢 pass (browser) (see test-shots/llm/E2E-03.png) |
| E2E-04 | P2 | 2 | failure | live | A remix generation attempt fails and shows the reason inline, not a toast | Valid `ANTHROPIC_API_KEY` set with `LLM_BASE_URL` pointed at a local address that is not answering, a remix session open at a generation stage. Setup gap: the `GenerationBlocked` panel (`generation-blocked.tsx`) carries no `data-testid` yet (filed to GitHub issues). | Arrive on the remix generation stage; Act: trigger the stage's generation | The stage swaps to the proxy-down block panel read from `data-testid="remix-generation-blocked"` (not present yet), showing the reason inline ("nothing answered at {proxyUrl}"), not a toast; the run log records a failed attempt. | none | 🟡 no LLM key (also testid `remix-generation-blocked` missing, TC-01) |
| E2E-05 | P1 | 3 | network | live | The 9router proxy is unreachable, so status reads Down rather than a false green | `LLM_BASE_URL` pointed at a stopped 9router (auto-manage off so the app does not respawn it), `/settings` open on the 9router section. | Arrive on `/settings#router`; Act: click `data-testid="router-check-button"` | `data-testid="router-status-badge"` reads "9router: Down" (`assert_text`), never "Up"; the reachable-but-unverified state is a distinct label the probe reserves for a router that answers `count_tokens` but fails generation. | none | 🟡 not browser-drivable (needs 9router stopped; this session's dependency state keeps 9router up and must not be changed) |
| E2E-06 | P2 | 3 | concurrency | offline | A status read in flight disables the racing controls, so a double action cannot fire twice | Seeded fixture database, `/settings` open on the 9router section. | Arrive on `/settings#router`; Act: click `data-testid="router-check-button"` | While the status read is in flight, `data-testid="router-start-button"` is disabled (the section gates every control on `busy !== null`), so a racing Start cannot spawn a second attempt; the badge `data-testid="router-status-badge"` then settles to a single resolved label. | `scripts/e2e/llm-e2e-06.sh` | 🟢 pass (browser) (see test-shots/llm/E2E-06.png) |
Retired (P0 slice 2a): E2E-07, the in-app re-analysis journey through the Re-analyze button, which no longer exists. A second `crowsnest_save_analysis` call is the agent-side equivalent and is covered by the analyze component's own cases, not here.

The `remix-generation-blocked` testid E2E-04 targets does not exist yet in `generation-blocked.tsx` (filed as TC-01 in GitHub issues (label `backlog`)), and the "Generate hooks" trigger E2E-02 drives has no testid yet either (tracked with remix's own browse-e2e); their assertions above are the target shape, not an executed run. The Settings and 9router testids E2E-01, E2E-03, E2E-05, and E2E-06 target do exist today in `secrets-section.tsx` and `router-section.tsx`.

Not checkable by hand:

- A full generation journey through remix's stepper (hooks, outline, and script variants landing in turn) belongs to remix's own browse-e2e cases; this layer's E2E-02 asserts only that one native structured call lands on a remix generation stage.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | `ANTHROPIC_API_KEY` is never returned to the browser or logged; the Settings API Keys card reports configured and source only, never the value. | A key set, either in the database or the environment. | 1. Call `secretStatus()` and inspect the shape returned.<br>2. Inspect the Settings API Keys card's rendered markup and network responses. | `secretStatus()` returns `{ name, configured, source }` with no `value` field; the UI never renders or transmits the raw key. | 🟢 pass (browser) (see test-shots/llm/SEC-01.png; checked the rendered `/settings` DOM for every "Configured" secret row (Graph token, Graph user ID, IG service token, IG session ID), no raw value string appears anywhere in the page markup) |
| SEC-02 | P1 | Secret handling | (confirmed issue) `kai kit init`'s `ANTHROPIC_API_KEY` prompt echoes the key in plaintext on a real TTY, landing it in terminal scrollback, despite being meant to be masked. | A real macOS TTY running `kai kit init`. | 1. Run `kai kit init` and type a value at the `ANTHROPIC_API_KEY` prompt. | The key is shown on screen as typed; `ask({ secret: true })` echo suppression is not working on the TTY (`src/cli/kai.ts:151`). Security and UX issue, not a functional blocker in this layer. | fail (confirmed) |
| SEC-03 | P1 | No buyer data leaving the box | The layer's only outbound call is to the configured Anthropic endpoint (the real API, or the local compat router); nothing routes generation content to any other destination. | Native and compat modes, each with request logging or a network capture available. | 1. Run a generation in native mode and inspect the outbound request target.<br>2. Repeat in compat mode. | Native: the request target is the Anthropic API. Compat: the request target is `LLM_BASE_URL`, a local address; nothing else is contacted. | 🟡 no LLM key (no generation can be triggered to capture an outbound target) |

Security-lite has no row for a license gate: llm has no license check of its own, its only gate is the Anthropic API key itself, which SEC-01 already covers as a secret-handling case. Crowsnest is single-user with no tenants, so there is no cross-tenant leakage row either.
