# Claude Code as the vision engine design

Date: 2026-08-03
Status: draft, two open decisions, needs Kai's approval before any code
Replaces the manual procedure in: docs/product/frame-pass-workflow.md

## Goal

Make the Layout section fill itself. Today the "Run frame pass" button always refuses,
and the only way to get a layout reading is a human running /watch in a terminal and
piping JSON into a CLI. This design has Crowsnest do that itself: extract frames, spawn
Claude Code as a subprocess to read them, write the result back.

Claude Code is the vision model. Kai has a Max plan, and the local `claude` binary is
already logged in. No API key, no hosted vision model, no change to the 9router proxy.

## What /watch actually is

Measured on this machine, not assumed. This finding shaped the whole design.

The skill is two halves and only one needs a model.

The mechanical half is `scripts/watch.py` in the claude-video plugin. It is Python
wrapping yt-dlp and ffmpeg. Scene-change detection selects frames, writes them as JPEGs
to a working directory, and prints a markdown report listing each path with its absolute
timestamp. There is no model call in it. Run against the 19 second video in the library
it produced 12 frames in 0.4 seconds.

The vision half is Claude calling `Read` on each JPEG path. That is the entire act of
watching. The skill body is a prompt telling Claude to read the files that watch.py just
wrote.

So there is no vision model inside the skill to borrow. The model is whichever one the
Claude Code session happens to be running.

## Verified before designing

- `claude` on PATH is a broken cmux shim that exits with "claude not found in PATH". The
  real binary is at /Users/kienbeovl/.local/bin/claude, version 2.1.220. Anything
  spawning it must use the absolute path.
- Headless works and can see images. `claude -p` with `--allowedTools Read` and
  `--output-format json`, pointed at two frames, returned
  `{"f1":"Claude","f6":"and could be"}`. Both readings are correct, checked against the
  same frames read by hand.
- 512px wide frames are legible. Caption text and logo wordmarks read cleanly at the
  watch.py default, so there is no need for the 1024px setting and its 4x token cost.
- One spawn carries about 35k tokens of fixed Claude Code system prompt overhead, paid
  whether the prompt holds 2 frames or 40. Frames themselves are cheap by comparison.
  The two frame test billed 0.24 USD equivalent on claude-opus-4-8 and took 8.7 seconds.

That overhead number is the reason this design uses one spawn per video and never one
spawn per frame.

Stage 1 has since been run over all 6 downloaded videos. Every one extracted without
trouble, 167 frames total: 58, 30, 27, 24, 16, 12, in the same order as the durations
below. Scene detection handled all of them, so no uniform-sampling fallback was needed.
A full library pass at today's 6 videos is therefore about 210k tokens of fixed spawn
overhead plus roughly 200k of frames.

One implementation note from doing that extraction by hand. Driving it from a shell
`while read` loop silently truncated a video id, because the subprocess consumed a byte
of the loop's stdin, and the run then wrote frames into a directory named for an id that
does not exist. The Node runner should pass a closed or ignored stdin to the child, and
the job should assert the id it finishes with is the id it started with.

## Current state of the data

- 6 videos have a downloaded mp4 (`video_asset_id` set, file present). All are 720x1280.
  Durations: 111s, 42s, 40s, 32s, 27s, 19s.
- The other 340 tracked videos have no video file. `EAGER_VIDEO_DOWNLOAD` is false, so a
  frame pass on them is blocked behind a sync that pulls assets. Out of scope here.
- `video_analyses` has 7 rows. Every one has `layout`, `frame_pass_at` and
  `frame_pass_error` null. No frame pass has ever run.
- docs/product/frame-pass-workflow.md line 95 says no video file has been downloaded yet.
  That is stale and should be corrected when this lands.

## Architecture

Three stages with hard boundaries. Each can fail on its own and be diagnosed on its own.

### Stage 1, extract

Crowsnest calls watch.py as a subprocess with `--no-whisper`, a chosen `--out-dir` under
the app's tmp area, and the resolved mp4 path from `resolveVideoFile`. It parses the
report's Frames section into a list of `{path, timestampSeconds, reason}`.

Crowsnest owns the frame budget rather than letting a prompt decide it. Deterministic and
effectively free.

`--no-whisper` is not only a cost choice. With no transcript in the subprocess context, a
layout field cannot be laundered out of spoken words. It makes the anti-fabrication rule
structural instead of a promise in a prompt.

### Stage 2, read

Crowsnest spawns the `claude` binary:

```
claude -p <prompt> --allowedTools Read --output-format json
```

The prompt carries the frame paths with their timestamps and asks for the four Layout
fields as JSON, each citing the timestamps it was read from. `--allowedTools Read` is the
security boundary: the subprocess gets no Bash, no file writes, no database handle. It is
a function from images to JSON.

The runner parses `result` out of the JSON envelope, then parses the JSON the model
produced inside it.

### Stage 3, write

The runner calls the existing `persistFramePass` in src/server/services/frame-pass.ts. No
change to that function. It already validates against `VideoLayoutSchema` and already
rejects a field that carries a value while citing no frames. A model that invents a
reading gets refused by code that predates it.

On any stage failing, the runner calls the existing `recordFramePassFailure` so the UI
shows "ran, came back empty" rather than "never run".

## Module layout

- `src/server/services/claude-task.ts`. One exported `runClaudeTask(prompt, opts)` that
  spawns the binary, enforces a timeout, and returns the parsed result or a typed error.
  Knows nothing about videos or layouts.
- `src/server/services/frame-pass-runner.ts`. Owns the three stages above. Calls watch.py,
  builds the prompt, calls `runClaudeTask`, calls `persistFramePass`.
- `src/server/services/frame-pass.ts`. Unchanged.
- `src/server/actions/analyze-actions.ts`. `runFramePassAction` stops returning
  `FRAME_NO_VISION_MODEL` and instead enqueues a job.

The seam is deliberately at `runClaudeTask`. It is narrow on purpose. A second consumer
will show what a general Claude Code engine actually needs, and guessing that now means
building the wrong abstraction.

## Job model

A frame pass takes tens of seconds to minutes, so it cannot be a plain server action.

New table `frame_pass_jobs`, copying the shape that already works for `sync_jobs`: id,
video_id, status, started_at, finished_at, heartbeat_at, error_code, error_message,
cancel_requested, and a unique partial index on running rows so only one pass runs at a
time.

Serial by design. Six parallel Claude sessions will hit Max plan rate limits, and there is
no reason to race.

This is the design's only schema change. Per the orchestrator, DDL against the shared
data/crowsnest.db has to be announced first, because the dev database is push based rather
than migration tracked and two hand-applied migrations at once is a real collision.

## What the proof pass changed about the prompt

Both of these came out of rehearsing stage 2 over the real library, and neither was
predictable from reading the source.

Ask for a short citation, not an exhaustive one. The first prompt let the model decide how
many timestamps to cite, and it cited every frame in all four fields. On a 27 frame video
that repetition ran long enough that the JSON came back truncated mid-array
(`...,33,35}}`) and the pass failed. Rewriting the rule as "cite 2 to 5 representative
timestamps" fixed it on the retry. The short citation is also the more honest one: a field
claiming all 27 frames as its source is not really citing anything.

Reading N frames costs about N+1 turns, and that is not fixable from the prompt. A 58
frame video took 59 turns, one Read per turn, with the context reprocessed each time. Turn
count, not frame count, is what the pass actually costs. Asking the model to batch every
Read into one message with parallel calls did not work: the 27 frame retry still took 28
turns. Measured cost for all 6 videos on Sonnet was roughly 3.7 USD equivalent, which the
Max plan covers. If that ever needs to come down, the lever is `--max-frames`, not the
prompt.

A cosmetic issue worth handling in the runner: some `fromFramesSec` arrays came back with
duplicate timestamps, for example `[0, 1, 1, 5, 9, 11, 11, 14]`. Valid, but the runner
should dedupe and sort before storing.

## Failure modes

- No mp4 for the video. `resolveVideoFile` already reports this. The job fails before
  spawning anything.
- watch.py exits non-zero, or the report lists no frames. Recorded as a failure with the
  stderr tail. No spawn happens.
- The spawn times out or the binary is missing. This is the cmux shim trap, so the runner
  checks the binary resolves before the first job rather than failing per video.
- The model returns prose instead of JSON, or JSON that fails `VideoLayoutSchema`. Treated
  as a failed pass and recorded. One retry, then give up.
- The model returns a value citing no frames. `persistFramePass` throws. This is correct
  behavior, not a bug to work around.

## Out of scope

- Per-frame timeline analysis. See open decision 2.
- Passes on the 340 videos with no downloaded file. That needs a sync with asset download.
- Any deployed or multi machine story. This binds to a local logged-in binary and a local
  file path, and it works on Kai's machine only.
- Batch or automatic passes. One button, one video, until the single path is proven.

## Open decisions

### 1. Which model reads the frames

Answered by the proof pass. Sonnet is good enough, so pin `--model sonnet`.

Evidence: one video was read twice, once by Sonnet through `claude -p` and once by hand
as a control. Sonnet's reading was the better of the two. It read all 12 frames where the
hand pass sampled 7, and it caught caption text the hand pass missed ("Government",
"Anthropic says", "powerful") plus a frame carrying a news headline and no caption bar.
Framing, text position and cut rhythm agreed with the control.

Across all 6 videos Sonnet filled 24 of 24 fields and every layout survived
`persistFramePass`.

### 2. Four fields, or a per-frame timeline

Kai's phrasing was "analyze every single frame". The schema, the writer and the Layout UI
today hold four fields and one reading per video.

Recommendation: ship the four fields first. A per-frame timeline needs its own table, its
own screen, and its own design pass. It roughly doubles the build and none of its storage
or UI exists yet.

## Build order

1. Manual proof pass over the 6 downloaded videos, using the existing CLI. Confirms the
   prompt produces layouts that survive `persistFramePass` before any of it is wrapped in
   code. Already cleared by the orchestrator.
2. `runClaudeTask` plus the frame extraction parser, with tests against a fixture report.
3. `frame_pass_jobs` table and the runner, after announcing the DDL.
4. Wire `runFramePassAction` and the button.
5. Correct the stale claim in docs/product/frame-pass-workflow.md and rewrite it as the
   fallback procedure rather than the primary one.

Steps 2 through 5 are gated on Kai approving this document.
