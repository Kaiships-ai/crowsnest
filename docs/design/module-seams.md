# Module seams for the five modules being added

Written 2026-07-28, before any of this code exists. Scope is deliberately narrow: where the seams go for five new modules, not a review of the codebase. Vocabulary follows the codebase-design skill (module, interface, implementation, seam, adapter, depth).

The precedent to copy is `src/server/transcribe/index.ts`. One exported function, a private provider chain inside it, typed errors carrying a reason per provider, and dependencies accepted as options rather than constructed. Callers learn one name and get the whole fallback chain.

## 1. The Claude Code engine

`LlmClient` already has two adapters (`AnthropicLlmClient`, `CompatLlmClient`) selected by `getLlm()` on an env check. Two adapters means the seam is real, so a third costs almost nothing.

Decision: add `ClaudeCodeLlmClient` as a third adapter satisfying the existing `LlmClient` interface unchanged. It shells out through `execFileP`, which is how whisper-cli and yt-dlp are already reached.

Decision: do **not** add images to `LlmClient`. An `images` parameter on `generateParsed` would widen the interface every caller has to learn, while two of the three adapters could not honour it. Run the deletion test: remove the parameter and complexity reappears in exactly one caller, the analyzer. One caller does not earn a place in a shared interface.

`getLlm()` gains a hint rather than a new export:

```
getLlm()                 // text, current behaviour
getLlm({ engine: "claude-code" })
```

Fallback belongs inside the module, not at call sites. When the 9router call throws, the module retries once on Claude Code and records which engine answered. Callers keep learning one function.

## 2. Frame extraction

`watch.py` is an external script, so it gets the same treatment as whisper-cli: detect, exec with a timeout, parse, hand back paths. The caller owns cleanup, matching the contract `downloadToTmp` already sets.

Module: `src/server/vision/frames.ts`

```
extractFrames(videoPath, opts?) -> { frames: { path, timestampSec, reason }[], workDir }
```

Behind that one name: resolving the skill directory, finding python3, choosing the detail mode, passing `--no-whisper` because Crowsnest already has a local transcript, applying the frame budget, and parsing the script's report into typed rows.

One interface fact worth hiding rather than exposing: the script lives under a version pinned plugin path (`~/.claude/plugins/cache/claude-video/watch/<version>/skills/watch/`), so a plugin upgrade moves it. Resolution happens inside the module, newest version wins, overridable with `WATCH_SKILL_DIR`. No caller should ever hold that path.

## 3. Visual analysis

This is the module the vision work actually belongs to, not the LLM client.

Module: `src/server/vision/analyze-visual.ts`

```
analyzeVisual(videoId, opts?) -> Layout
```

Inside: make sure the video file is on disk, extract frames, load the stored transcript, call Claude Code with both, validate against a Zod schema, retry once on a malformed reply, persist.

Dependencies come in through `opts` (`frames`, `llm`, `transcribe`), exactly as `getOrCreateAnalysis(videoId, { llm, transcribe })` already does, so tests never spawn a subprocess.

The interface is the test surface. If a test needs to reach past `analyzeVisual` to assert something, the module is the wrong shape.

Note on the existing defect this replaces: `styleTags` in `analyze-prompt.ts` asks the model to describe visual style while forbidding it to invent visuals, and hands it only a transcript. The stored row reads `["fast-cut","on-screen-text"]` for a video no model ever saw. Layout moves to this module and stops being guessed.

## 4. Owned channel access

Mirror `src/server/ig/client.ts`: a typed client, an error taxonomy, and mapping done at the edge so no snake_case body ever escapes.

Modules: `src/server/graph/client.ts` and `src/server/graph/errors.ts`

```
fetchAccount()            -> OwnedAccount
fetchPosts(limit)         -> OwnedPost[]
fetchInsights(mediaId)    -> Insight
```

Metrics are the ones `ig_stats.py` already requests, so the two tools agree: reach, saved, shares, total_interactions, comments, likes, plus views for reels.

Typed error worth building on day one: an expired token returns an error naming the exact fix, refresh in Kai-Official-OS then paste into this project's `.env.local`. Kai chose a copied token over a shared file, so the copy will go stale on its own, and a September auth failure with no explanation is the predictable outcome without this.

Testing discipline, learned the hard way and written in the README: fixtures must match what the client returns after mapping, not the raw API body. Type them with `satisfies` against the interface.

## 5. Owned channel sync

`sync-engine.ts` is 1350 lines with 1772 lines of tests pinning it. It should not absorb another job.

Run the deletion test on merging them. Tracked sync and owned sync share no auth, no API, no metrics, no cooldown, no ban risk. What they do share is three things at the end: upserting video rows, downloading assets, recomputing scores.

So extract the shared part and leave the different parts apart.

- New module `src/server/services/owned-sync.ts`, beside `sync-engine.ts`, not inside it.
- Extract `recomputeChannelScores` out of `sync-engine.ts` into `src/server/services/scoring.ts` and export it.

That extraction is not hypothetical. Deleting the 22 legacy rows on 2026-07-28 needed a rescore from outside the sync engine, and the only way to get one was a throwaway script that re-implemented the function. A seam you have already had to work around is a real seam.

No other refactor of `sync-engine.ts` is justified by current evidence. Leave it.

## 6. MCP entry point

Module: `src/mcp/server.ts`, run with tsx, no Next process involved.

The service layer has no Next coupling (one comment and one `"use server"` in `preview-action.ts`), and `scripts/live-sync.ts` already proves headless execution works. That is why this is an entry point rather than a port.

One rule decides whether this stays clean: MCP tools call queries and services, never server actions. Actions are `"use server"` and Next owns them.

Each tool should be thin enough that there is nothing in it worth testing. Branching inside a tool means the logic belongs in a service, where the UI gets it too. That is the whole leverage argument: one implementation paying back across two front ends.

## What is not being decided here

The Claude Code pane docked in the sidebar. That is a UI decision and belongs in the Plannotator review with the rest of the flows.
