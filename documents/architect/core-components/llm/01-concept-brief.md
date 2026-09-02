# llm: concept brief

The LLM layer: how analyze and remix reach a model (direct Anthropic API or a local proxy).

## What it is

The llm layer (`src/server/llm/client.ts`) is the single place every AI feature, analysis
of a video and every remix generation stage, goes through to reach a language model. It
exposes one client interface (`generateText`, `generateParsed`, `ping`) with two
implementations picked at runtime by whether `LLM_BASE_URL` is set. With no override, it
talks to the real Anthropic API directly using the Anthropic SDK's native structured
output support. With `LLM_BASE_URL` set, an OpenAI-compatible local router sits in front
of the request instead (a proxy such as 9router routing to a different backing model);
because such routers do not implement Anthropic's structured-output contract, that path
falls back to asking for JSON in the system prompt and parsing the response by hand, with
the same one-retry-then-fail behavior as the native path. The model used is
`process.env.CLAUDE_MODEL`, defaulting to `claude-sonnet-5` when unset. The API key itself
is resolved through the app's secret store, database first, environment variable fallback,
so a key entered in Settings takes effect immediately without a server restart.

## Why it exists

Generation needs two separate things that fail differently: an Anthropic API key, the
credential, and the proxy, a base URL override that routes the same request somewhere
else. A machine can have one without the other, and the user-visible failure is different
in each case, a missing key is a configuration state nothing was attempted, a reachable
key with an unreachable proxy is a connection failure after a real attempt. This layer
exists to hold that distinction in one place (`NoApiKeyError` thrown before any request is
made when there is no key) rather than letting every caller reimplement its own check, and
to let the whole rest of the app, the feed, the calendar, saving, scheduling, degrade
around a missing or unreachable model instead of failing outright: nothing outside
analysis and generation needs this layer at all.

## Boundaries

This layer owns resolving which client to construct (native Anthropic or compat router),
resolving the model id and the key, making the actual request, and the one retry on a
malformed structured output before raising `LlmParseError`. It does not own what callers do
with a failure: a caller (a server action) catches `NoApiKeyError` and the SDK's typed
error classes and turns them into the user-facing states described in
[external services](../../shared/external-services.md), a block panel with the no-key or
proxy-down reason in the remix studio, a key alert in the analyze gate. It does not own
transcription (a separate, keyless-capable path through whisper.cpp or a network provider)
or the Graph API metrics on the user's own channel; those are different external
dependencies with their own failure surfaces. An Anthropic API key is required either way,
`LLM_BASE_URL` only changes where the request is routed, not whether a key is needed; there
is no fully keyless path through this layer the way there is for local transcription.
Whether the no-proxy path (a real Kit install talking straight to the Anthropic API with
its default model, no local router in front of it) completes a live analysis end to end is
called out as unverified in
[packaging and release](../../shared/packaging-and-release.md).
