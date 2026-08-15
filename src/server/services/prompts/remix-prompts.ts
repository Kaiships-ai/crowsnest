import type { Outline } from "@/server/llm/schemas";

/**
 * Prompts for the `remix` service (Task 5). Kept in their own file, versioned and
 * editable without touching the service logic — see the plan's Global Constraints.
 * Every user-builder takes `niche` as a plain string parameter (pulled from
 * `app_settings.niche_profile` by the service layer, not read here) so these stay
 * framework-free and trivially testable.
 */

export const HOOK_SYSTEM = `You are a short-form video scriptwriter. Write 5 scroll-stopping opening hooks (each 15 words or fewer) for the given topic, tailored to the given niche, mirroring the structure and tone of the given hook pattern. When a source's mechanism (why it worked) and opening line are given, mirror that mechanism and the opening line's rhythm and pacing too, not only the hook pattern category. Do not use hashtags or emojis unless the pattern itself uses them. Each hook should stand alone as a single opening line — no numbering, no explanation, no surrounding quotes.`;

// `facts` (all three builders below) is the Research stage's editable facts box
// (remix.ts's ResearchNotes.facts) — review finding H1: every generation stage must
// be grounded by whatever the user researched/noted about the source video, not just
// the topic/niche/pattern. Optional (and only appended when non-empty) because
// Quick Remix and any session that skips straight past Research still need to work.
// `steer` (all three builders below) is the comment-to-regenerate box (spec part 6):
// a one-off note that reruns that stage with extra direction, same optional-line
// pattern as `facts`, appended last so it reads as the most recent instruction.
export function buildHookUser(opts: {
  topic: string;
  niche: string;
  pattern: string;
  facts?: string;
  whyItWorked?: string;
  openingLine?: string;
  steer?: string;
}): string {
  const lines = [`Topic: ${opts.topic}`, `Niche: ${opts.niche}`, `Hook pattern to mirror: ${opts.pattern}`];
  if (opts.whyItWorked) lines.push(`Why the source worked: ${opts.whyItWorked}`);
  if (opts.openingLine) lines.push(`Source opening line: ${opts.openingLine}`);
  if (opts.facts) lines.push(`Facts to incorporate: ${opts.facts}`);
  if (opts.steer) lines.push(`Steer: ${opts.steer}`);
  return lines.join("\n");
}

export const OUTLINE_SYSTEM = `You are a short-form video scriptwriter. Build a beat-by-beat outline for a video of the given target length, following the given structure pattern. Each beat needs a short label, a one-sentence description of what happens in it, and a target timestamp in seconds (cumulative, within the total target length, non-decreasing across beats). When a source's mechanism (why it worked) is given, keep that mechanism working across the beats, not only the beat timing.`;

export function buildOutlineUser(opts: {
  topic: string;
  niche: string;
  hook: string;
  targetLengthSec: number;
  structure: string;
  facts?: string;
  whyItWorked?: string;
  steer?: string;
}): string {
  const lines = [
    `Topic: ${opts.topic}`,
    `Niche: ${opts.niche}`,
    `Chosen hook: ${opts.hook}`,
    `Target length: ${opts.targetLengthSec} seconds`,
    `Structure pattern to follow: ${opts.structure}`,
  ];
  if (opts.whyItWorked) lines.push(`Why the source worked: ${opts.whyItWorked}`);
  if (opts.facts) lines.push(`Facts to incorporate: ${opts.facts}`);
  if (opts.steer) lines.push(`Steer: ${opts.steer}`);
  return lines.join("\n");
}

export const SCRIPT_SYSTEM = `You are a short-form video scriptwriter. Write a full spoken-word script from the given hook and outline — conversational, natural to say out loud, timed to the target length within +/-10%. When a source that worked is given, adapt its structure, pacing, and mechanism to the given topic — do not copy the source's words. After each beat, add a "[VISUAL] ..." cue line describing what should be on screen. Return only the script text, no preamble or explanation.`;

// A source beat as stored on `StoredStructureSegment` (llm/schemas.ts): `transcript` is
// optional because a beat analyzed before the per-beat transcript field shipped has none.
// Anti-fabrication (spec's "guard"): undefined means "not captured" and renders nothing
// for that beat's transcript — never a placeholder the model would read as words spoken.
export interface SourceBeat {
  label: string;
  startSec: number;
  endSec: number;
  note: string;
  transcript?: string;
}

export function buildScriptUser(opts: {
  topic: string;
  niche: string;
  hook: string;
  outline: Outline;
  targetLengthSec: number;
  facts?: string;
  similar?: string[];
  sourceBeats?: SourceBeat[];
  whyItWorked?: string;
  steer?: string;
}): string {
  const beats = opts.outline.beats
    .map((beat) => `- ${beat.label} (~${beat.targetSec}s): ${beat.content}`)
    .join("\n");
  const lines = [
    `Topic: ${opts.topic}`,
    `Niche: ${opts.niche}`,
    `Hook: ${opts.hook}`,
    `Target length: ${opts.targetLengthSec} seconds`,
    "Outline:",
    beats || "(no outline beats yet — write a natural hook/build/payoff/CTA structure)",
  ];
  if ((opts.sourceBeats && opts.sourceBeats.length > 0) || opts.whyItWorked) {
    lines.push(
      "Source that worked:",
      "Adapt this source's structure, pacing, and mechanism to the topic above — do not copy its words."
    );
    if (opts.whyItWorked) lines.push(`Why it worked: ${opts.whyItWorked}`);
    for (const beat of opts.sourceBeats ?? []) {
      const line = `${beat.label} (${beat.startSec}s to ${beat.endSec}s): ${beat.note}`;
      lines.push(beat.transcript ? `${line}\nsaid: ${beat.transcript}` : line);
    }
  }
  if (opts.facts) lines.push(`Facts to incorporate: ${opts.facts}`);
  if (opts.similar && opts.similar.length > 0) {
    lines.push("Similar outliers for reference:", ...opts.similar.map((item) => `- ${item}`));
  }
  if (opts.steer) lines.push(`Steer: ${opts.steer}`);
  return lines.join("\n");
}
