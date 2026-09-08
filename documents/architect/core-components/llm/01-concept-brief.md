# llm: concept brief

`documents/architect/core-components/llm/`

Status: shipped and in use by remix and the ideas loop, the no-proxy path (a real Kit install talking straight to the Anthropic API) has not been proven to complete a live generation end to end.

## 1. What it is

The llm layer (`src/server/llm/client.ts`) is the single place every in-app AI feature in crowsnest, every remix generation stage and the ideas loop, goes through to reach a language model. It exposes one client interface, `generateText`, `generateParsed`, and `ping`, with two implementations picked at runtime by whether `LLM_BASE_URL` is set. With no override it talks to the real Anthropic API directly, using the Anthropic SDK's native structured-output support. With `LLM_BASE_URL` set, an OpenAI-compatible local router sits in front of the request instead, a proxy such as 9router routing to a different backing model. Because such routers do not implement Anthropic's structured-output contract, that path falls back to asking for JSON in the system prompt and parsing the response by hand, with the same one-retry-then-fail behavior as the native path. The model used is `process.env.CLAUDE_MODEL`, defaulting to `claude-sonnet-5` when unset. The API key itself is resolved through the app's secret store, database first, environment variable fallback, so a key entered in Settings takes effect immediately without a server restart.

## 2. Why it exists

Generation needs two separate things that fail differently: an Anthropic API key, the credential, and the proxy, a base URL override that routes the same request somewhere else. A machine can have one without the other, and the user-visible failure differs in each case: a missing key is a configuration state where nothing was attempted, while a reachable key with an unreachable proxy is a connection failure after a real attempt. This layer exists to hold that distinction in one place, throwing `NoApiKeyError` before any request is made when there is no key, rather than letting every caller reimplement its own check, and to let the whole rest of the app, the feed, the calendar, saving, scheduling, degrade around a missing or unreachable model instead of failing outright. Nothing outside remix, the ideas loop, and the health checks needs this layer at all.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| LlmClient | The one interface every caller programs against: `generateText`, `generateParsed`, `ping`. Two classes implement it, `AnthropicLlmClient` and `CompatLlmClient`; callers never know which one they got. |
| Native path | The default, no `LLM_BASE_URL` set. The real Anthropic API, reached with the SDK's native structured-output support (`messages.parse` plus `output_config: { format: zodOutputFormat(schema) }`). |
| Compat path | `LLM_BASE_URL` set. A local OpenAI-compatible router (for example 9router) sits in front of the request. It translates the Anthropic streaming wire format but not the non-streaming one and ignores structured-output config, so this path always streams and gets JSON by asking for it in the system prompt. |
| NoApiKeyError | Thrown by `getLlm()` before any network call when no `ANTHROPIC_API_KEY` is resolvable. A configuration state, not a network failure; callers map it to their own "add your key in Settings" surface. |
| LlmParseError | Thrown when a structured call still fails schema validation after one retry, on either path. |
| resolveModel | Returns `process.env.CLAUDE_MODEL ?? "claude-sonnet-5"`. `client.ts` calls it internally on every request, so text, structured, and ping calls all name the model the same way. Exported, but no current caller persists the model id. |
| Secret store | `getSecret` (`src/server/secrets/store.ts`), database first, environment fallback. The Anthropic API key is a managed secret; a key set through Settings takes effect on the next call because `resetLlmClient()` drops the cached client. |
| Generation probe | `probeLlmGeneration`, a health check that runs a real one-word `generateText` alongside `ping` and classifies the pair into `up`, `reachable_unverified`, or `down`, because a passing `ping` alone does not prove the configured model generates anything. |

## 4. How it fits in the system

The llm layer sits between its callers, remix and the ideas loop for generation plus the health surfaces (the Settings API Keys card's Test button and the router status check), and one external destination: the Anthropic API, reached either directly or through a local compat router. It owns no page of its own; every generation and connection check the app performs runs through `getLlm()` and one of the client's three methods. Callers inject a fake client in tests (`opts?.llm ?? getLlm()`), so the rest of the app's test suite runs with zero live API calls. The layer's only persistent read is the Anthropic API key from the `secrets` table; it writes nothing to the database itself, the idea row, the remix session, and the run log all belong to the callers that invoke it.

## 5. Dependency map

### Upstream (what llm depends on)

| Dependency | Why |
| --- | --- |
| `@anthropic-ai/sdk` | The Anthropic SDK used for every request, on both the native and compat paths; the compat path constructs the same SDK client with a different `baseURL`. |
| Secret store (`src/server/secrets/store.ts`) | Resolves `ANTHROPIC_API_KEY`, database first, environment fallback. `getLlm()` throws before any request if no key is resolvable. |
| `CLAUDE_MODEL`, `LLM_BASE_URL` (env) | `CLAUDE_MODEL` overrides the default model id; `LLM_BASE_URL`, read straight from the environment rather than the secret store, selects the compat path when set. |
| zod | Every structured-output schema (`schemas.ts`) is a Zod schema, validated by the SDK's `zodOutputFormat` on the native path and by hand with `safeParse` on the compat path. |

### Downstream (what depends on llm)

| Consumer | What it reads |
| --- | --- |
| remix (`src/server/services/remix.ts`) | Calls `generateParsed` for hooks and the outline, and `generateText` for the script variants, one call per slot via `Promise.allSettled`. |
| ideas (`src/server/services/ideas.ts`) | Calls `generateParsed` with `IdeaSchema` for a generated content idea. |
| Settings API Keys card (`src/server/actions/settings-actions.ts`) | Calls `ping()` through `testAnthropicKeyAction` for the Test button. |
| Router status (`src/server/actions/router-actions.ts`) | Calls `probeLlmGeneration` to report the LLM's up, reachable-unverified, or down state. |
| remix-actions.ts | Catches `NoApiKeyError` and maps every other failure through `llmErrorMessage` to surface a block panel reason. |

Analyze is no longer a consumer of this layer. `analyze.ts` still imports `VideoAnalysisSchema` from `schemas.ts`, but only as the validation contract for the agent-authored write path (`saveAgentAnalysis`, reached through the keyless `crowsnest_save_analysis` MCP tool); it is not a `generateParsed` target and `analyze.ts` makes no call into the client.

### External

| Dependency | Role |
| --- | --- |
| Anthropic API | The real destination on the native path; every request needs a valid `ANTHROPIC_API_KEY` regardless of which path is taken. |
| 9router (local OpenAI-compatible proxy) | The optional local router the compat path talks to when `LLM_BASE_URL` is set, managed by a separate process supervisor (`src/server/llm/router-control.ts`). |

## 6. Boundaries

This layer owns resolving which client to construct, native or compat, resolving the model id and the key, making the actual request, and the one retry on a malformed structured output before raising `LlmParseError`. It does not own what callers do with a failure: a caller (a server action) catches `NoApiKeyError` and the SDK's typed error classes and turns them into the user-facing states described in [external services](../../shared/external-services.md), a block panel with the no-key or proxy-down reason in the remix studio, and the connection result on the Settings API Keys card's Test button. It does not own transcription, a separate keyless-capable path through whisper.cpp or a network provider, or the Graph API metrics on the user's own channel; those are different external dependencies with their own failure surfaces. An Anthropic API key is required either way: `LLM_BASE_URL` only changes where the request is routed, not whether a key is needed, and there is no fully keyless path through this layer the way there is for local transcription. Whether the no-proxy path completes a live generation end to end with a real Kit install is called out as unverified in [packaging and release](../../shared/packaging-and-release.md).
