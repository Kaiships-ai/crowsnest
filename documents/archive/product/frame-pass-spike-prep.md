# Frame pass, what is known before the spike runs

Written 2026-07-31 while the LLM proxy was down. `v1-scope.md` calls the frame
pass the single biggest risk to V1: the one job is "take its hook, its script
and its layout", and layout is the only one of the three that is a vision
problem. Everything here was established by reading the code, so the spike can
start from it rather than rediscovering it.

## The client cannot send an image today

`src/server/llm/client.ts:40` defines the whole interface:

```
generateText(opts: { system: string; user: string; maxTokens?: number })
generateParsed<T>(opts: { system: string; user: string; schema, maxTokens? })
ping()
```

`user` is a string, and both implementations pass it straight through as
`messages: [{ role: "user", content: opts.user }]`. There is no content-block
path, no image type, no base64 handling anywhere in `src/server/llm/`.

So the frame pass needs a third method on `LlmClient` that takes content blocks,
plus an implementation in both the SDK client and `CompatLlmClient`. That is
additive and does not disturb the two existing methods or their callers.

## Nothing samples frames yet

`grep` for ffmpeg across `src/server` finds `lib/exec.ts` (a generic runner) and
`transcribe/whispercpp.ts` (audio). No video frame extraction exists. The spike
needs to build sampling as well as the model call: pick N frames across the
video, resize them to something a model will accept, and hand them over.

`services/` and the media pipeline under `src/server/ig/assets.ts` are where the
downloaded video already lives, so the input is at least on disk.

## The unknown that only the proxy can answer

`CompatLlmClient` exists because the local router only translates the streaming
wire format, so it already has to stream everything and prompt-engineer its JSON
rather than use structured output. Whether that same router relays image content
blocks at all is the open question, and it cannot be answered by reading code.

Three outcomes, worth deciding in advance:

1. The router relays images. Build the frame pass on the configured model.
2. The router does not, but the model behind it can see. Either fix the router
   or bypass it for this one call.
3. The model cannot see at all. The layout read needs a different model, and
   that is a cost and configuration decision rather than a code one.

Answer this before any UI is built on top, per the build order. A layout section
designed against an assumption that fails is rework on the one screen whose job
is explaining a score.

## Preconditions for running the spike

- The proxy on `localhost:20128` must be up. It was unreachable at the time of
  writing, which is why the spike had not started.
- Use `localhost`, never `127.0.0.1`, anywhere this app is driven in a browser.
  Next 16 silently blocks Server Actions as cross origin on the IP form, and the
  failure is completely silent.
