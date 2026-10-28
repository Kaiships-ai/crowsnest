---
name: proof-video
description: Add captions, narration cues, or zoom to a proof video or PR recording of the crowsnest UI, and treat the recording as validation, not only demo capture. Trigger:/proof-video
---

# Proof video

Use this developer skill for captioned crowsnest UI recordings. Treat the
recording as validation, not only demo capture: the run is a real journey
through the real UI, so a recording that shows an error state, a blank surface,
or a wrong result is a failed proof, not a rough take. Captions are burned into
an MP4; they are visual narration, not synthesized audio.

Keep the raw video as evidence, attach the polished MP4, and never commit media
or `.artifacts/` output. Save the raw video and the MP4 under `data/verify/evidence/<run-id>/`.
In a worktree, run `.claude/skills/verify/scripts/keep-evidence.sh` when the recording is
done, so the proof lands in `~/.claude/orchestrate/proof/evidence/<branch>/` before the worktree is retired. Inspect the entire capture for unrelated or private
content (a real Instagram handle, a session cookie, a burner credential) before
publishing under the PR's existing authorization.

## Record against the real, seeded UI

Record against the seeded Lead Studio app, the same isolation the verify lanes
use: `.claude/skills/verify/scripts/app-up.sh --seed` (a fresh `scripts/seed-e2e.ts`
database in a temp user data dir), with `APP_RECORD_VIDEO=<dir>` for a webm.
Never record against an operator's real data or a live Instagram session unless
the proof is specifically about live sync, and then redact.

The app journeys (`app-drive.sh`) drive the UI; `APP_RECORD_VIDEO` captures the raw
video. There is no caption, zoom, or speed cue API yet, so hand-write the cue sidecar
below.

While recording, keep narration to one or two short lines per caption; oversized
text should fail rather than clip. Avoid clipped, locator, or full-page
screenshots mid-recording: Chromium can corrupt the screencast surface. Caption
rasterization must happen after the recording context closes, in a fresh context.

## Cue sidecar v1

Save a hand-written `cues.json` beside the raw `.mov`, `.webm`, or `.mp4`. Use
`scale` for actual raw pixels per viewport CSS pixel, not display metadata. Input
dimensions must equal viewport times scale, and frame rate must be constant. All
times are seconds in the RAW video. Caption image paths are relative to the
sidecar directory. Zoom cues cannot overlap other zoom cues; speed cues cannot
overlap other speed cues. Adjacent cues are allowed.

```json
{
  "version": 1,
  "video": "capture.webm",
  "viewport": { "width": 1280, "height": 800 },
  "scale": 2,
  "captionHeight": 120,
  "cues": [
    {
      "kind": "caption",
      "start": 1,
      "end": 4,
      "text": "Filter the feed to 5x and above.",
      "image": "captions/0.png"
    },
    {
      "kind": "zoom",
      "start": 1,
      "end": 4,
      "rect": { "x": 20, "y": 150, "width": 280, "height": 80 },
      "factor": 2,
      "ease": 0.5
    },
    { "kind": "speed", "start": 5, "end": 9, "factor": 4 }
  ]
}
```

Cue semantics: a caption replaces the current on-screen caption for its window;
`zoom` starts or replaces a zoom on a rectangle (padding expands and clamps the
target, and its center is the focus); `zoomOut` ends it; `speed(factor)` changes
playback until the next speed cue, and `speed 1` restores normal playback.
Rectangles use viewport CSS pixels. Caption PNGs are transparent, viewport-width,
120-pixel-high strips with a centered dark rounded card and roughly 30-pixel
system text.

## Render

Render with a system ffmpeg and ffprobe, never a bundled encoder. Install a full
build with `brew install ffmpeg` or `apt install ffmpeg`. The renderer must
refuse an existing output file so raw evidence and earlier renders are preserved.

TODO: wire a render script (`scripts/render-proof-video.mts` or equivalent) that
consumes `cues.json`. It should: split the raw timeline for speed segments with
trim, setpts, and concat, then normalize to the input frame rate; remap caption
windows and zoom transitions to output time; apply zoom with `zoompan` at `d=1`
and matching input FPS; and overlay pre-rasterized caption PNGs after the zoom.
Output should be viewport-sized H.264 MP4, yuv420p, CRF 23, faststart, no audio.
The pipeline needs crop, scale, overlay, setpts, trim, concat, fps, and zoompan
in the ffmpeg build; it does not use `subtitles=` or `drawtext=`, since captions
are overlaid as PNGs. A rasterize step should create missing caption PNGs with a
fresh Chromium page; neither path needs libass or drawtext.

## Limitations

- Context `deviceScaleFactor: 2` can record a padded, downscaled frame in some
  Chromium builds; launching with `--force-device-scale-factor=2` and leaving
  context emulation at 1 records true 2x content. For verified 1x capture, launch
  without the flag and pass `deviceScaleFactor: 1`. A render can Lanczos
  pre-upscale a 1x source but cannot restore lost detail, so a 2x zoom on a 1x
  recording is softer.
- The cue clock and the video clock can differ by roughly 100 ms, and
  startup and load can increase the skew; inspect action-to-caption alignment in
  the finalized recording.
- GitHub's player ignores subtitle tracks, so captions must be burned in.
- Variable frame-rate native captures need conversion to a constant-frame-rate
  working copy first; retain the original. Frame-rate quantization can shift
  speed-segment boundaries by about one output frame.
- Before attaching the MP4, check its duration and extract caption, zoom-hold,
  and sped-segment frames to confirm the proof actually shows the working surface.
