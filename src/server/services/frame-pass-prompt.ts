import { BEAT_LAYOUT_FIELDS, VideoLayoutSchema, type VideoLayout } from "@/server/llm/schemas";
import type { SampledFrame } from "./watch-frames";

export class LayoutParseError extends Error {}

/** The beat window the layout rows are keyed to. Structurally the subset of the
 *  analysis's `structureSegments` this prompt needs. */
export interface LayoutBeat {
  label: string;
  startSec: number;
  endSec: number;
}

/**
 * The prompt handed to the read-only Claude subprocess.
 *
 * The short-citation rule is load-bearing and came from a failed pass, not from taste.
 * Left to choose, the model cited every sampled frame in every field; on a 27 frame video
 * that repetition ran long enough that the JSON came back truncated mid-array and the
 * pass failed outright. Going per beat multiplies the number of fields, so the cap is
 * tighter here than the flat pass's 2 to 5: a beat spans a handful of frames, and 1 or 2
 * of them is a real citation. A field claiming every frame is not citing anything.
 *
 * Beats come from the analysis, never from this pass. A frame reader inventing its own
 * beat boundaries would produce a layout that lines up with nothing.
 */
export function buildLayoutPrompt(frames: SampledFrame[], beats: LayoutBeat[]): string {
  const list = frames.map((f) => `${f.path} at t=${f.timestampSeconds}s`).join("\n");
  const beatList = beats
    .map((b, i) => `${i + 1}. "${b.label}" covering t=${b.startSec}s to t=${b.endSec}s`)
    .join("\n");
  const example = JSON.stringify(
    beats.map((b) => ({
      startSec: b.startSec,
      endSec: b.endSec,
      label: b.label,
      ...Object.fromEntries(BEAT_LAYOUT_FIELDS.map((k) => [k, { value: null, fromFramesSec: [] }])),
    }))
  );

  return `You are reading ${frames.length} still frames sampled from one vertical short-form video.

${list}

Read EVERY frame listed above.

This video has already been broken into ${beats.length} story beats:

${beatList}

Report the video's LAYOUT as JSON only: one object per beat, in the order listed, as a
single JSON array. No prose, no markdown fence.

Each beat object carries startSec, endSec and label copied EXACTLY from the beat list
above, plus these six readings:
  onScreenText - what the burned-in caption says during this beat.
  animation    - motion applied to the frame or its contents, e.g. "slow push in", "hard shake on the cut", "none".
  demoCursor   - whether a mouse cursor is visible and what it is doing, e.g. "cursor dragging a slider".
  toolDemo     - which app or tool is on screen during this beat, e.g. "VS Code", "none, talking head".
  textPosition - where the caption sits in frame, e.g. "centered, upper third".
  voicePace    - how fast the delivery reads FROM THE FRAMES, e.g. "rapid, subtitle changes every frame".

Rules that matter more than completeness:
- Read each beat only from the frames whose timestamp falls inside that beat's window. A frame outside the window is evidence about a different beat.
- fromFramesSec cites 1 to 2 REPRESENTATIVE timestamps in seconds from inside that beat's window. Do NOT list every frame.
- If a beat's window contains no sampled frame, set all six values to null and every fromFramesSec to [].
- If you cannot read a field from that beat's frames, set value to null and fromFramesSec to [].
- Never state a value you did not see. A value with no backing frame is rejected on write.

Output exactly this shape, with your readings filled in:
${example}`;
}

/**
 * Find every substring of `s` that is a balanced `open...close` span, starting the scan
 * from each `open` in turn. String-aware: a bracket inside a quoted JSON string value
 * (and a quote escaped with a backslash inside that string) does not affect depth, so a
 * value like "use [square] brackets" does not corrupt the match boundary. A span with no
 * matching close (depth never returns to 0) yields nothing for that start index.
 *
 * Nested braces inside an array span do not need their own tracking: they are balanced
 * by construction in any JSON the scan would accept, and an unbalanced one just makes
 * `JSON.parse` reject that candidate.
 */
function balancedCandidates(s: string, open: string, close: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== open) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end !== -1) {
      candidates.push(s.slice(i, end + 1));
    }
  }
  return candidates;
}

/**
 * Pull a VideoLayout out of whatever the model printed. Tolerates a markdown fence and
 * surrounding chatter, refuses anything that is not a complete, well-shaped layout.
 *
 * Chatter tolerance is a balanced-brace scan, not a first-`{`-to-last-`}` slice: a stray
 * brace anywhere in a prose aside (models add these despite being told not to) would
 * otherwise move the slice boundary and turn a perfectly good layout into a parse
 * failure. Every balanced `{...}` span in the text is tried in order; a span that parses
 * as JSON but is not a VideoLayout (a scratchpad object the model printed before the
 * real answer, say) is skipped rather than treated as fatal, so the scan keeps going
 * until it finds one that qualifies or runs out of candidates.
 *
 * Timestamps are deduped and sorted because observed output repeated them, for example
 * [0, 1, 1, 5, 9, 11, 11, 14]. Valid, but noise we should not store.
 */
export function parseLayoutResult(text: string): VideoLayout {
  const stripped = text.replace(/```(?:json)?/g, "").trim();

  // Square brackets now, because the layout is an array of beat rows. An empty array is
  // not a layout (it would mean "the pass read no beats at all", which is a failure, not
  // a reading), so the length check keeps `[]` from parsing as a success.
  for (const candidate of balancedCandidates(stripped, "[", "]")) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }

    const parsed = VideoLayoutSchema.safeParse(raw);
    if (!parsed.success || parsed.data.length === 0) continue;

    const layout = parsed.data;
    for (const beat of layout) {
      for (const key of BEAT_LAYOUT_FIELDS) {
        beat[key].fromFramesSec = [...new Set(beat[key].fromFramesSec)].sort((a, b) => a - b);
      }
    }
    return layout;
  }

  throw new LayoutParseError(`no VideoLayout JSON found in model output: ${stripped.slice(0, 200)}`);
}
