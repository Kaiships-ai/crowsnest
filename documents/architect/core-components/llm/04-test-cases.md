# llm: test cases

How to run these: the llm layer has no screen of its own, so most cases are verified
through the surfaces that call it. Start the dev server and open
`http://localhost:3001` (never `127.0.0.1`), on a database with at least one tracked
channel that has finished a sync and at least one analyzable video (a stored transcript or
a reachable transcript provider). Toggle the two llm inputs independently: set or unset
`ANTHROPIC_API_KEY` (unset for the no-key state), and set or unset `LLM_BASE_URL` to a
local 9router (unset for the native path, set for the compat path). A key set through the
Settings API Keys card lands in the db and wins over the env. The layer's unit behavior
(retry, loose-JSON parse, error mapping) is covered by `src/server/llm/client.test.ts`,
`error-message.test.ts`, and `generation-probe.test.ts` — the code-level cases below name
those as the check rather than a hand step.

## Reach the model (a generation request)

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM-01 | P1 | no key | `getLlm()` throws `NoApiKeyError` before any request when no key is resolvable, so a missing key never hits the network. | `ANTHROPIC_API_KEY` unset, no db row for it. | 1. On an analyzable video, click Analyze.<br>2. Open a remix and try a generation stage. | Analyze shows the key alert / fails naming the missing key; the remix generation stages show the block panel with the no-key reason. No request was attempted. | not run |
| LLM-02 | P1 | key, native | A native structured call returns a schema-valid result via `messages.parse` + `zodOutputFormat`. | `ANTHROPIC_API_KEY` set, `LLM_BASE_URL` unset, a transcript present. | 1. Analyze the video. | The analysis row is written with hook, beats, tags, and note, validated against `VideoAnalysisSchema`; the tabs show the result. | not run |
| LLM-03 | P1 | code | `generateParsed` retries exactly once on a null `parsed_output`, then throws `LlmParseError`; a non-2xx SDK error is not retried. | — | 1. Run the `client.test.ts` cases for the retry and the typed-error propagation. | A null structured output retries once then raises `LlmParseError`; an SDK error propagates untouched with no second call. | not run (covered by `src/server/llm/client.test.ts`) |
| LLM-04 | P1 | key, compat | On the compat path the client streams and parses prompt-engineered JSON (`parseLooseJson`), same one-retry-then-`LlmParseError` contract. | `ANTHROPIC_API_KEY` set and `LLM_BASE_URL` pointed at a running 9router. | 1. Run a remix hook or outline generation. | Hooks/outline come back parsed and schema-valid even though the router drops `output_config.format`; a malformed reply retries once then fails. | not run |
| LLM-05 | P1 | key | The model is `resolveModel()` — `claude-sonnet-5` unless `CLAUDE_MODEL` overrides it — and the resolved name is recorded on the analysis row. | A key set; leave `CLAUDE_MODEL` unset, then set it and re-analyze. | 1. Analyze, read `video_analyses.model`.<br>2. Set `CLAUDE_MODEL`, re-analyze, read it again. | First row records `claude-sonnet-5`; after the override the row records the overridden id. | not run |
| LLM-06 | P1 | key change | A key set through Settings takes effect without a restart, because `resetLlmClient()` drops the cached client. | Start with no key, LLM features blocked. | 1. Paste the key in Settings and save.<br>2. Without restarting, run a generation. | The generation runs against the just-saved key; no server restart needed. | not run |
| LLM-07 | P1 | proxy/key | The layer distinguishes "no key" (`NoApiKeyError`, nothing attempted) from a proxy/SDK failure (a real attempt failed), and callers map them to different surfaces. | Two states: (a) key unset; (b) key set but `LLM_BASE_URL` pointed at a stopped router. | 1. In state (a) try a remix generation.<br>2. In state (b) try one. | (a) block panel names the missing key; (b) block panel names the proxy down (a connection error). The two read differently. | not run |
| LLM-08 | P2 | key, compat | Script variants are per-slot isolated: one failed variant becomes `{ error }` at its slot and the call does not throw; zero of N succeeding is the failed-attempt fact the run log records. | A remix at the script stage, a key set. | 1. Generate variants with the model reachable, then force one slot to fail. | Failed slots show an inline error; the others still land; a run-log row records the attempt, Partial when some succeeded and Failed when none did. | not run |
| LLM-09 | P2 | key | A re-analysis calls the model again and overwrites only the text columns; the layout columns and the first-analyzed timestamp are untouched. | An analyzed video that also has a frame-pass layout. | 1. Click Re-analyze.<br>2. Check the layout columns and `createdAt`. | Hook, beats, tags, note, and `model` are replaced; the layout and the first-analyzed timestamp are unchanged. | not run |
| LLM-10 | P2 | code | `llmErrorMessage` maps the typed SDK hierarchy most-specific-first (`AuthenticationError`, `RateLimitError`, `APIConnectionError`, then base `APIError`); `NoApiKeyError` is handled by the caller, not here. | — | 1. Run the `error-message.test.ts` cases. | Each typed error maps to its friendly string; the base `APIError` catch stands in last; `NoApiKeyError` is not handled by this helper. | not run (covered by `src/server/llm/error-message.test.ts`) |

## Check the connection (ping and the generation probe)

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM-11 | P1 | key | The Settings "Test" button calls `ping()` — a $0 `count_tokens` call — and reports whether the key is valid and reachable, consuming no generation quota. | A key set. | 1. Open Settings, API Keys, click Test on Anthropic. | The card reports the key working; no generation is billed. With the key unset it reports "ANTHROPIC_API_KEY is not set.". | not run |
| LLM-12 | P1 | key, compat | `probeLlmGeneration` reports `up` only when a real one-word generation returns text; a passing ping with failed generation reports `reachable_unverified`; neither answering reports `down`. | Three states: native key working; compat router that answers `count_tokens` but 410s on generation; router stopped. | 1. Run the LLM status check in each state. | Working native -> `up`; router that pings but cannot generate -> `reachable_unverified`; nothing answering (or no key) -> `down`. | not run |
| LLM-13 | P2 | code | The probe times ping and generation independently, so the pair never takes longer than one call, and a `NoApiKeyError` from `getLlm()` is caught and reported as `down`. | — | 1. Run the `generation-probe.test.ts` cases. | Each half is timed out separately; a missing key resolves to `down` with its message rather than throwing. | not run (covered by `src/server/llm/generation-probe.test.ts`) |

## Configuration and packaging

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM-14 | P1 | kit init | (BUG 2) `kai kit init` echoes `ANTHROPIC_API_KEY` in plaintext despite the "not echoed" prompt, landing the key in terminal scrollback. | A real macOS TTY running `kai kit init`. | 1. Run `kai kit init` and type a value at the `ANTHROPIC_API_KEY (blank to skip, not echoed)` prompt. | The key is shown on screen as typed; `ask({ secret: true })` echo suppression is not working on the TTY (`src/cli/kai.ts:151`, `hide` guard at line 60). Security/UX issue, not a functional blocker. | fail (confirmed, `evidence/10-onboarding-bugs.md` BUG 2) |
| LLM-15 | P1 | kit init | A blank key at kit init is allowed and skips the LLM features; the app still installs and every non-AI page renders. | `kai kit init` on a fresh install. | 1. Press Enter to skip the `ANTHROPIC_API_KEY` prompt.<br>2. Open the app. | `.env.local` has no key; the feed, calendar, planner, and saving all work; analyze and remix show their key gates. | not run |
| LLM-16 | P2 | native, real key | (open) The no-proxy path — a real Kit install hitting the Anthropic API directly with the default model, no local router — completes a live analysis or remix generation end to end. | A real Kit install with a real key and `LLM_BASE_URL` unset. | 1. Analyze a real video.<br>2. Run a remix generation. | Record what happens: whether native generation completes end to end with real credentials. Called out as unverified in `../../shared/packaging-and-release.md`. | not run |

Not checkable by hand:

- Whether `messages.parse` actually issues a second HTTP call on the one retry, versus the
  SDK short-circuiting — observable only at the network layer or in `client.test.ts`.
- Whether a compat-mode `count_tokens` really tokenizes locally while `/v1/messages` fails
  for the same model, which is the premise of the `reachable_unverified` state.
- The exact wording a live `AuthenticationError` versus `RateLimitError` produces on the
  Settings card, without inducing each real error against the Anthropic API.
