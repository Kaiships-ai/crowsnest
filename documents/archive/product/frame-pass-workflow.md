# Frame pass workflow (layout reads via Claude Code)

The Layout section of the video detail screen (on-screen text, its position, cut
rhythm, framing) is a vision task. Nothing in the running app's own LLM client can do
it: that client has no image path, and the 9router proxy relays no live vision model.
Every `nvidia/*` model is 410 Gone, and the `combo` models behind `openclaw` and
`hermes` are text-only DeepSeek, which rejects `image_url` content with a 400.

The app works around that instead of waiting on it. Clicking "Run frame pass" on the
video detail screen starts a job that extracts frames from the video's local mp4,
hands them to a read-only Claude Code subprocess, and writes the result through the
same validator a human would use by hand. That in-app pass is the primary way to
produce a frame pass now. The manual CLI procedure documented below is the fallback:
use it when the automated pass fails, or when someone needs to write a reading by
hand.

## The in-app pass

Triggered by `runFramePassAction` in `src/server/actions/analyze-actions.ts`, which
calls `runFramePass` in `src/server/services/frame-pass-runner.ts`. That runner wires
together three pieces:

- `src/server/services/watch-frames.ts` extracts frames from the video's mp4 by
  shelling out to the claude-video plugin's `watch.py` (yt-dlp plus ffmpeg, no model
  involved), and parses its report into a timestamped frame list.
- `src/server/services/claude-task.ts` spawns the local Claude Code CLI in print mode
  with `--allowedTools Read`, so the subprocess can open the frame files it is told
  about and nothing else: no shell, no writes, no database handle.
- `src/server/services/frame-pass-prompt.ts` builds the prompt handed to that
  subprocess and parses its JSON response back into a `VideoLayout`.

The result is written through `persistFramePass` in
`src/server/services/frame-pass.ts`, the same function the manual CLI calls. Only one
pass runs at a time, enforced by a partial unique index on `frame_pass_jobs`. The
client polls `getFramePassJobAction` for job status rather than holding the action
open, since a pass takes tens of seconds.

If a video has no downloaded mp4 yet, the pass fails with `FRAME_NO_VIDEO_ASSET` and
the Layout section explains why. Videos are not eagerly downloaded
(`EAGER_VIDEO_DOWNLOAD=false`), so a freshly synced post needs a sync with downloads
before a frame pass can run against it.

## The manual fallback

Use this when the in-app pass fails and needs a closer look, or when someone wants to
write a reading by hand without going through the automated path.

### What produces the read

A Claude Code session using the `/watch` skill. `/watch` downloads (if needed),
samples frames with ffmpeg, and hands the JPEGs to Claude to Read. Claude looks at
the frames and fills the four Layout fields, citing which frame timestamps each
reading came from. That citation is not optional: `fromFramesSec` is the
anti-fabrication device, and a value with no backing frame is rejected by the writer.

### What receives the read

`scripts/frame-pass.ts`, backed by `persistFramePass` in
`src/server/services/frame-pass.ts`. It validates the JSON against
`VideoLayoutSchema`, enforces the "a value must cite frames" rule, and upserts the
`video_analyses` row (leaving any existing text analysis untouched).

### Steps

1. Find the video's local file:

   ```
   npx tsx scripts/frame-pass.ts resolve <videoId>
   ```

   If it prints `no file: ...`, the video has not been downloaded yet. Videos are
   not eagerly downloaded (`EAGER_VIDEO_DOWNLOAD=false`), so run a sync that pulls
   the video asset first. `/watch` needs a real file; do not point it at the
   Instagram URL, since yt-dlp cannot pull a login-walled reel.

2. In a Claude Code terminal session, watch the file:

   ```
   /watch <path-from-step-1>
   ```

   Read the frames. Write the four fields as JSON, each with the frame timestamps
   (in seconds) the reading came from. A field you genuinely cannot read gets
   `value: null` and an empty `fromFramesSec`. Do not guess from the transcript,
   which is the one thing this whole feature exists to prevent.

   ```json
   {
     "onScreenText":  { "value": "POV: your first month", "fromFramesSec": [0.5, 1.5] },
     "textPosition":  { "value": "centered, upper third", "fromFramesSec": [0.5] },
     "cutRhythm":     { "value": "hard cut about every 2s", "fromFramesSec": [2, 4, 6] },
     "framing":       { "value": "close-up talking head", "fromFramesSec": [0] }
   }
   ```

3. Write it in (`--frames-sampled` is how many frames `/watch` extracted):

   ```
   npx tsx scripts/frame-pass.ts write <videoId> \
     --layout layout.json --frames-sampled 14 --model claude-code/watch
   ```

   The detail screen's Layout section now shows the four fields and a caption naming
   the frame count and model. Re-running overwrites the previous read.

4. If the pass ran and could read nothing (too dark, no text, unreadable), record
   that instead of writing a blank layout, so the screen says "ran, came back empty"
   rather than "never run":

   ```
   npx tsx scripts/frame-pass.ts fail <videoId> --error "no legible on-screen text"
   ```

### Rehearsing without touching the real database

Point `CROWSNEST_DB_PATH` at a copy so a practice run never lands in
`data/crowsnest.db`:

```
cp data/crowsnest.db /tmp/fp-copy.db
CROWSNEST_DB_PATH=/tmp/fp-copy.db npx tsx scripts/frame-pass.ts write ...
```

## What is proven and what is not

All 6 videos with a downloaded mp4 have been read successfully: 24 of 24 layout
fields came back readable, and every result was accepted by `persistFramePass`. The
anti-fabrication guard has been tested directly, with a deliberately fabricated
layout, and it was rejected as designed.

Not yet tried: a frame pass, in-app or manual, against any of the videos that have
no downloaded mp4 (most of the library, since `EAGER_VIDEO_DOWNLOAD=false` means most
posts are synced without their video asset). That needs a sync with asset download
first, not more code in this path.
