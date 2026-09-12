# MCP tool reference

This is the reference for an agent (Claude, Codex, or any other MCP client) driving crowsnest.

Crowsnest is the data and action brain; your agent is the reasoning brain. Crowsnest holds the
tracked channels, the outlier feed, video analyses, remix sessions, and content artifacts, and
it takes actions like syncing a channel or creating a draft post. It does not think for you: the
agent reads crowsnest's data, writes its own reasoning back, and steers each step.

The whole surface is keyless. No `ANTHROPIC_API_KEY` and no LLM proxy are used anywhere in it.
Where a step needs a reasoning model, crowsnest hands the agent an assembled prompt to fulfill and
takes the agent's own answer back; it never calls a reasoning model itself. The one exception is
transcription: `crowsnest_transcribe` runs a speech-to-text provider (local whisper.cpp, or Groq
when `GROQ_API_KEY` is set) to turn a video into text. That is not the reasoning brain and needs
no `ANTHROPIC_API_KEY`.

The endpoint is `http://localhost:3000/api/mcp`, streamable HTTP. Register it with
`kai mcp` (see [buyer quickstart](../../business-requirement/buyer-quickstart.md)).

## The 30 tools by phase

Every tool name is prefixed `crowsnest_`. Inputs marked optional have defaults noted where they
matter. Unknown ids and handled failures come back as a readable error result, not a thrown
exception.

### Sync control

Freshen the channels you plan from before you read them. Check readiness first so a failed sync
is not the first sign the sidecar needs starting.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_ig_status` | Whether the Instagram sidecar is reachable and, if so, logged in. Carries the exact command to start it. | none |
| `crowsnest_sync_selected` | Start a sync scoped to the given channels; returns a `jobId`. Refuses an empty list (there is no whole-library default). | `channelIds` (non-empty array, from `crowsnest_channels`) |
| `crowsnest_sync_status` | Read a sync run's progress by job id. Null progress for an unknown job is not an error. | `jobId` |
| `crowsnest_sync_cancel` | Cooperatively cancel a running sync; it stops at the next channel boundary, keeping committed work. | `jobId` |

### Inspect and read

Read the landscape and the working set. These change nothing.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_channels` | The tracked channels and their fleets, the set you plan from. | none |
| `crowsnest_channel_stats` | One channel's baseline, median basis, and last sync health. | `channelId` |
| `crowsnest_feed` | The outlier feed: top videos from tracked channels, ranked, with the total match count. | `minScore`, `minViews`, `sinceDays`, `followerBand` (`nano`\|`mid`\|`macro`), `query`, `analyzed` (`yes`\|`no`), `sort` (`score`\|`recent`\|`views`, default `score`), `limit` (24), `offset` |
| `crowsnest_video` | One video with its analysis, transcript, and metrics, plus media and thumbnail file paths for the Reel Factory handoff. | `videoId` (from `crowsnest_feed`) |
| `crowsnest_research_set` | A broad reading bundle: top outliers with their analyses, plus your own reach benchmark, so each idea reads against both competitor score and your own reach. | `minScore`, `sinceDays`, `query`, `limit` (24) |
| `crowsnest_outlier_pack` | A tight top-N shortlist ready to act on, with the media handoff and your own benchmark. Set `rising=true` with a short `sinceDays` for this week's surges. | `limit` (8), `sinceDays`, `rising` |
| `crowsnest_metrics` | The own channel's current window and the same-length prior window (month over month), plus recent measured own posts. Needs an own channel and a valid Graph token. | `windowDays` (30), `limit` (20) |
| `crowsnest_plans` | Planned posts (dated intentions to publish), optionally within a date range. Read-only. | `from`, `to` (`YYYY-MM-DD`) |
| `crowsnest_scripts` | Every saved script, newest first. A script is the text a remix produced. | `limit` (50), `offset` |
| `crowsnest_ideas` | The ideas inbox or shortlist: short concepts for the weekly plan. | `tab` (`inbox`\|`shortlist`, default `inbox`), `limit` (50), `offset` |
| `crowsnest_brief` | A planned post's brief: title, source video (with media file paths), remix hook and beats, layout, and score, for the Reel Factory handoff. | `postId` (from `crowsnest_remix_finish` or `crowsnest_plans`) |

### Analyze and persist

When a strong outlier has no analysis, write one yourself and save it. Crowsnest validates the
fields against the same schema the app uses, stamps the row `source="mcp"`, and stores it. Remix
and Ideas then read your analysis unchanged. No model is called; you are the model.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_save_analysis` | Save the per-video analysis you wrote, with provenance. Rejects an unknown video id or fields that fail validation, writing nothing. | `videoId`, `hookType`, `structureSegments` (beats: `{ label, startSec, endSec, note, transcript }`), `formatTags`, `styleTags`, `whyItWorked` |

### Transcribe on demand

When a video has no transcript yet, fetch and transcribe it so `crowsnest_video` can return the
words to ground your analysis. A repeat call returns the cached transcript instantly.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_transcribe` | Fetch one video (downloading it from Instagram if not already stored) and transcribe it, returning its verbatim transcript; caches the result. Needs a live sidecar to download a new video and a transcript provider (local whisper.cpp, or Groq with `GROQ_API_KEY`). | `videoId` (from `crowsnest_feed`) |

### Content artifacts

Your larger, cross-video reasoning outputs, persisted as crowsnest's source of truth with
provenance. The five kinds are `angles`, `outlier_library`, `idea_bank` (put 100+ ideas in one
artifact), `monthly_plan` (Week 01 to 04), and `brief`. The `data` payload is your own JSON; its
shape is up to you for the kind. Keyless: neither tool calls a model.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_save_artifact` | Persist an artifact you authored. Pass an existing `id` to update it in place. Returns the stored artifact with its id and timestamps. | `kind` (`angles`\|`outlier_library`\|`idea_bank`\|`monthly_plan`\|`brief`), `title`, `data` (your JSON), `agent`; optional `sourceVideoIds`, `model`, `assumptions`, `id` |
| `crowsnest_artifacts` | Read back what you (or a prior run) persisted: list newest first, filter by kind, or fetch one by id. | optional `id`, `kind`, `limit` (20), `offset` |

### Remix chain

Turn one source video into a script and a draft post, one tool per step, so you steer each
stage. There is one session per source video. This chain is keyless end to end.

Three stages return a prompt for you to fulfill rather than generating anything: `hooks`,
`outline` (in its prompt mode), and `variants`. Each returns an assembled `{ system, user,
context }`; you write the answer and hand it back through the matching write tool. Everything
else reads or persists directly. `crowsnest_remix_research` is neither a prompt nor a model
call: it assembles research notes from the data for you to read.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `crowsnest_remix_session` | Get or create the one session for a source video; returns its state. | `videoId` |
| `crowsnest_remix_state` | Read the current session state: topic, chosen hook, outline, variants, chosen variant. | `sessionId` |
| `crowsnest_remix_set_prompt` | Persist the topic, niche, and target length. Only the given fields change. | `sessionId`; optional `topic`, `niche`, `targetLengthSec` |
| `crowsnest_remix_research` | Assemble research notes from the source analysis, transcript, and similar outliers. Returns notes, not a prompt. No model call. | `sessionId` |
| `crowsnest_remix_hooks` | **Returns a prompt.** The Hooks-stage `{ system, user, context }`. You write the hook options, then set your pick with `crowsnest_remix_choose_hook`. | `sessionId`; optional `vaultItemId`, `steer` |
| `crowsnest_remix_choose_hook` | **Persists.** Set the chosen hook by text (one you wrote, or your own). | `sessionId`, `hook` |
| `crowsnest_remix_style` | **Persists.** Set the style vault item, or omit it to clear and use the source video's own structure. | `sessionId`; optional `styleVaultItemId` |
| `crowsnest_remix_outline` | **Bidirectional.** With no `outline`, returns the Outline-stage prompt for you to fulfill. With an `outline` (`{ beats: [{ label, content, targetSec }] }`), persists it, so the script prompt carries your real beats. | `sessionId`; optional `steer` (prompt mode), `outline` (save mode) |
| `crowsnest_remix_variants` | **Returns a prompt.** The Script-stage `{ system, user, context }`, built from the chosen hook and your saved outline. You write the script, then save it. `context.angles` lists per-take angles to append if you want more than one take. | `sessionId`; optional `steer` |
| `crowsnest_remix_save_script` | **Persists.** Save the script text you wrote as this session's script, titled. | `sessionId`, `title`, `script` |
| `crowsnest_remix_finish` | **Persists.** Create (or reuse) an undated draft planned post carrying the chosen script; returns its `postId`. Idempotent. | `sessionId` |

Save the outline back before calling `crowsnest_remix_variants`. The script prompt reads the
session's saved outline, so a run that never saves an outline gets a script prompt with no beats
in it.

## Example prompts

Realistic prompts to give your agent. Each names the tools it will use, and points out where a
tool hands back a prompt for the agent to fulfill rather than doing the work itself.

**Fresh sync of selected channels.**
"Check whether the Instagram sidecar is ready. If it is, list my tracked channels, sync the
three I name, and poll until the sync finishes."
Uses `crowsnest_ig_status`, then `crowsnest_channels` for the ids, `crowsnest_sync_selected` to
start, and `crowsnest_sync_status` to poll.

**Inspect this week's outliers.**
"Pull the top 8 rising outliers from the last 7 days and, for the two strongest, open the video
and summarize its transcript and why it might be over-performing."
Uses `crowsnest_outlier_pack` with `rising=true` and `sinceDays=7`, then `crowsnest_video`.

**Write and save an analysis.**
"Open video V, read its transcript and metrics, write an analysis of why it over-performed (hook
type, story beats, format and style tags), and save it back to crowsnest under your name."
Uses `crowsnest_video`, then `crowsnest_save_analysis`. You are the model here; crowsnest only
validates and stores what you wrote. If `crowsnest_video` returns a null transcript, call
`crowsnest_transcribe(videoId)` first, then re-read the video.

**Save an idea bank of 100+ ideas.**
"Read the research set for the productivity niche, then brainstorm 120 short-form ideas grounded
in those outliers and save them as one idea_bank artifact, stamped with your name, model, and the
source video ids. Then read it back so I can see it stored."
Uses `crowsnest_research_set`, then `crowsnest_save_artifact` with `kind=idea_bank` (all 120
ideas in one artifact's `data`), then `crowsnest_artifacts` to confirm.

**Persist a Week 01 to 04 monthly plan.**
"Using the outlier pack and my own-channel metrics, draft a monthly plan with Week 01 through
Week 04 and a top pick per week, and save it as a monthly_plan artifact with your assumptions
recorded."
Uses `crowsnest_outlier_pack` and `crowsnest_metrics`, then `crowsnest_save_artifact` with
`kind=monthly_plan`.

**Remix a video into a draft post.**
"Remix video V into a 45-second script. Set the topic and length, build research, write five
hooks and pick the strongest, write the beat outline and save it, then write the script and
finish to a draft post. Give me the brief at the end."
Uses `crowsnest_remix_session`, `crowsnest_remix_set_prompt`, and `crowsnest_remix_research`,
then the keyless prompt stages: `crowsnest_remix_hooks` hands back a prompt and you write the
hooks (`crowsnest_remix_choose_hook` saves the pick); `crowsnest_remix_outline` with no argument
hands back a prompt and you write the outline, then call it again with the `outline` to save it;
`crowsnest_remix_variants` hands back a prompt and you write the script, then
`crowsnest_remix_save_script` saves it. `crowsnest_remix_finish` creates the draft post, and
`crowsnest_brief` reads its brief with the source media paths for the Reel Factory handoff.
