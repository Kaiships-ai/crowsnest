# External services

The core loop runs on the local database. A few things reach past it to a service that may not answer. This page is the single account of what each one is for, how it authenticates, what limits apply and what the user sees when it is down. The shape is the same for all of them: the feature that needs the service becomes visibly unavailable and labeled, and everything else keeps working. No service failure takes down the feed, the calendar, the planner, saving or scheduling.

## The service map

| Service | Needed by | Auth | When down | Rest of the loop |
| --- | --- | --- | --- | --- |
| Instagram, through the sidecar | New videos in the feed; sidecar-side channel and post fetch | Shared token `IG_SERVICE_TOKEN` for the Node to sidecar hop; an Instagram session (username and password, or an imported session id) held by the sidecar | Feed goes stale, never errors. A failed sync shows in the failure strip. | Works on the videos already stored |
| Instagram Graph API | Own-channel measurement, own-post insights, and publishing | `IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID` (secret or environment); host `graph.instagram.com`, version `IG_GRAPH_API_VERSION` (default v21.0) | A connect panel names what is missing. Past measurements still show under it. Publish fails with a coded error. | Feed, remix and planning work. Planning and scheduling need no token until the moment of publish. |
| Anthropic API | In-app generation: remix hooks, outline and variants, and Generate idea | `ANTHROPIC_API_KEY` secret. Model `CLAUDE_MODEL`, default `claude-sonnet-5`. | No key shows a block panel on the generation stages; a failed call returns a toast. | Works, minus in-app generation |
| LLM proxy (optional) | The same in-app generation, routed through a local OpenAI-compatible router (9router) when `LLM_BASE_URL` is set | None of its own | Inferred from the run log, not pinged (below) | Works |
| Transcript providers | A transcript for a video that has none stored | whisper.cpp is local and keyless; Groq needs `GROQ_API_KEY` | If neither is available, transcription fails with the reasons from each provider | A stored transcript needs no provider |
| Local Claude Code CLI | The frame pass (layout analysis from sampled frames) | The user's own Claude Code login | The frame-pass job ends failed with an error code | Works |
| Polar | License activation at install and `kai login` | License key; public customer-portal endpoints | Install or login fails. The running app never calls it. | Not applicable |

The agent that reasons over MCP is not a dependency of the app. It is a client. See [decision 0002](../decisions/0002-data-and-action-brain.md).

## Instagram sidecar

The sidecar (`services/ig`) is the only code that logs in to Instagram. The Node side talks to it over loopback (`IG_SERVICE_URL`, default `http://127.0.0.1:8765`) with request timeout `IG_REQUEST_TIMEOUT_MS` (30 s) and download timeout `IG_DOWNLOAD_TIMEOUT_MS` (120 s). Retryable upstream errors are retried `SYNC_MAX_RETRIES` times (default 3) with doubling jittered backoff, replaced by Instagram's own `retry_after_sec` when it supplies one.

Failure behavior is classified by error code (`src/server/ig/errors.ts`) into service down, session expired, rate-limited cooldown, network, or a fact about one post or channel. Only the first four are treated as facts about the shared connection. See [jobs-and-failures](jobs-and-failures.md) for how each shows.

The sidecar serializes every real Instagram call behind one process-global lock. Raising `syncConcurrency` therefore never produces concurrent Instagram traffic. Dependency status for the sidecar and the LLM backend is classified in `src/components/status/dependency-status.ts`.

## Graph API

The token is checked on load and the answer is cached for 5 minutes when definitive and 30 seconds when transient (`src/server/graph/token-status.ts`). States are `ok`, `not_configured`, `auth_failed`, `permission_denied`, `rate_limited`, `network` and `unknown`.

- **Never measured, or no token.** The connect panel stands alone. There are no tiles to show.
- **Measured before, token invalid now.** The connect panel sits above the last measured numbers. A failing live check and figures measured earlier are different facts, so history is never hidden.
- **Limits.** A scheduled measurement uses at most 150 calls, a manual full measurement 190 (`own-measure.ts`). Missing reach renders as a dash, never zero.
- The Graph path posts to and reads from the user's own account. It is a separate credential from the sidecar's burner session.

## Anthropic API and the proxy

Generation needs a key, and the proxy is an optional route for it. They fail differently and the block panel (`generation-blocked.tsx`) names which one:

- **No key.** `getLlm()` throws `NoApiKeyError` before any request. Callers turn it into "add your key in Settings". This is a configuration state, not a network failure.
- **Key present, proxy unreachable.** The request fails with a connection error, written to the run log as a failed row.

"Proxy down" is inferred, not pinged. `isProxyLikelyDown` (`src/components/remix/run-log-view.ts`) is true when any of the last three run rows carries a connection-style message (`connection error`, `econnrefused`, `fetch failed`, `network error`), or when a variant run reports zero successes. The next successful attempt clears it. The inference can lag the real proxy in both directions.

A passing `count_tokens` ping proves the key and, in direct mode, the model. Through the proxy it only proves the proxy answers, so `classifyLlmStatus` never reports proxy-mode ping success as fully up (`reachable_unverified`).

The prompt and research stages call no model and stay usable when generation is blocked. A hook chosen before the outage keeps Continue enabled from the stored choice.

## Transcript providers

`getOrCreateTranscript` (`src/server/transcribe/index.ts`) returns a stored transcript first, then tries whisper.cpp, then Groq, and persists the result so later reads reuse it. whisper.cpp is available only when `whisper-cli` resolves on PATH (or `WHISPER_CPP_BIN_PATH`) and the model file exists (`WHISPER_MODEL_PATH`). With none available it throws `NoTranscriptProviderError` carrying each provider's reason. A video with no downloaded video asset throws `VideoNotDownloadedError`; there is no remote-URL fallback.

The MCP tool `crowsnest_transcribe` is the on-demand path. Transcription is keyless with whisper.cpp, so a machine with no Anthropic key can still transcribe.

## Persistence and failure

A service failure writes nothing partial. A failed generation appends a failed `remix_runs` row and leaves the targeted field at its previous value. A transcript, once made, is stored and reused. States produced by a failure are read on page load, not pushed, so an open page repaints only on navigation or refresh.

## Where to look

- `src/server/ig/client.ts`, `src/server/ig/errors.ts`, `src/server/config.ts`
- `src/server/graph/client.ts`, `src/server/graph/token-status.ts`
- `src/server/llm/client.ts`, `src/server/llm/router-control.ts`
- `src/server/transcribe/`
- `src/server/services/claude-task.ts`
- `src/cli/license.ts`
