# Frame pass workflow (layout reads via a Claude Code session)

The Layout section of the video detail screen (on-screen text, its position, cut
rhythm, framing) is a vision task. Nothing in the running app can do it: the LLM
client has no image path, and the 9router proxy relays no live vision model. Every
`nvidia/*` model is 410 Gone, and the `combo` models behind `openclaw` and `hermes`
are text-only DeepSeek, which rejects `image_url` content with a 400. So the in-app
"Run frame pass" button in `LayoutSection` correctly refuses, and it should keep
refusing until a vision model is actually reachable from the server.

Until then the read is produced out of process, in a Claude Code terminal session
that can see images, and written back into the database. This doc is that procedure.

## What produces the read

A Claude Code session using the `/watch` skill. `/watch` downloads (if needed),
samples frames with ffmpeg, and hands the JPEGs to Claude to Read. Claude looks at
the frames and fills the four Layout fields, citing which frame timestamps each
reading came from. That citation is not optional: `fromFramesSec` is the
anti-fabrication device, and a value with no backing frame is rejected by the writer.

## What receives the read

`scripts/frame-pass.ts`, backed by `persistFramePass` in
`src/server/services/frame-pass.ts`. It validates the JSON against
`VideoLayoutSchema`, enforces the "a value must cite frames" rule, and upserts the
`video_analyses` row (leaving any existing text analysis untouched).

## Steps

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

## Rehearsing without touching the real database

Point `CROWSNEST_DB_PATH` at a copy so a practice run never lands in
`data/crowsnest.db`:

```
cp data/crowsnest.db /tmp/fp-copy.db
CROWSNEST_DB_PATH=/tmp/fp-copy.db npx tsx scripts/frame-pass.ts write ...
```

## What is proven and what is not

The write path and the render are proven: a valid layout written by the CLI shows up
in the Layout section with the right values and provenance caption. The one untested
link is `/watch` over a real tracked Instagram video, because no video file has been
downloaded yet. That needs one real sync with asset download (the same blocker as
running a watched multi-channel sync), not more code.
