import { VideoLayoutSchema, type VideoLayout } from "@/server/llm/schemas";
import type { SampledFrame } from "./watch-frames";

export class LayoutParseError extends Error {}

const LAYOUT_KEYS = ["onScreenText", "textPosition", "cutRhythm", "framing"] as const;

/**
 * The prompt handed to the read-only Claude subprocess.
 *
 * The "2 to 5 representative" citation rule is load-bearing and came from a failed pass,
 * not from taste. Left to choose, the model cited every sampled frame in all four fields;
 * on a 27 frame video that repetition ran long enough that the JSON came back truncated
 * mid-array and the pass failed outright. The short citation is also the more honest one,
 * since a field claiming all 27 frames as its source is not really citing anything.
 */
export function buildLayoutPrompt(frames: SampledFrame[]): string {
  const list = frames.map((f) => `${f.path} at t=${f.timestampSeconds}s`).join("\n");
  return `You are reading ${frames.length} still frames sampled from one vertical short-form video.

${list}

Read EVERY frame listed above.

Then report the video's LAYOUT as JSON only. No prose, no markdown fence.

Fields:
  onScreenText - what the burned-in caption text says. Summarise if it changes across the video.
  textPosition - where that text sits in frame, e.g. "centered, upper third".
  cutRhythm    - how often the shot cuts, e.g. "hard cut about every 2s".
  framing      - shot type, e.g. "close-up talking head", "split screen, screen recording above".

Rules that matter more than completeness:
- fromFramesSec cites 2 to 5 REPRESENTATIVE timestamps in seconds that best evidence that value. Do NOT list every frame.
- If you cannot read a field from the frames, set value to null and fromFramesSec to [].
- Never state a value you did not see. A value with no backing frame is rejected on write.

Output exactly this shape:
{"onScreenText":{"value":null,"fromFramesSec":[]},"textPosition":{"value":null,"fromFramesSec":[]},"cutRhythm":{"value":null,"fromFramesSec":[]},"framing":{"value":null,"fromFramesSec":[]}}`;
}

/**
 * Find every substring of `s` that is a balanced `{...}` span, starting the scan from
 * each `{` in turn. String-aware: a brace inside a quoted JSON string value (and a
 * quote escaped with a backslash inside that string) does not affect brace depth, so
 * a value like "use {curly} braces" does not corrupt the match boundary. A span with
 * no matching close (depth never returns to 0) yields nothing for that start index.
 */
function balancedBraceCandidates(s: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;

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
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
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

  for (const candidate of balancedBraceCandidates(stripped)) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }

    const parsed = VideoLayoutSchema.safeParse(raw);
    if (!parsed.success) continue;

    const layout = parsed.data;
    for (const key of LAYOUT_KEYS) {
      layout[key].fromFramesSec = [...new Set(layout[key].fromFramesSec)].sort((a, b) => a - b);
    }
    return layout;
  }

  throw new LayoutParseError(`no VideoLayout JSON found in model output: ${stripped.slice(0, 200)}`);
}
