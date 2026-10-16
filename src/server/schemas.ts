import { z } from "zod";

/**
 * Structured-output schemas for every Claude call in the AI half of the product
 * (Task 1 of docs/superpowers/plans/2026-07-24-phase3-remix-vault.md). Each is passed
 * to `LlmClient.generateParsed` via `zodOutputFormat` (see client.ts) — the SDK
 * guarantees the parsed result matches the shape below, or client.ts throws
 * `LlmParseError` after one retry. Keep these in sync with the prompts that target
 * them (remix-prompts.ts describes the shape in prose; these `z.object`s are the
 * enforced contract). VideoAnalysisSchema itself is now also the validation contract
 * for `saveAgentAnalysis` (analyze.ts) — the external agent's MCP-authored analysis
 * is checked against the exact same schema an in-app model call used to produce.
 */

/**
 * One story beat. `note` is the model's one-sentence summary of the beat; `transcript`
 * is the verbatim words spoken inside the beat window, copied out of the full transcript
 * the analyze prompt already carries (spec decision D1, path b). The words are assigned
 * to beats by the model rather than sliced against provider segment times, so the
 * alignment is model-judged; the words themselves are quoted, never paraphrased.
 */
export const StructureSegmentSchema = z.object({
  label: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  note: z.string(),
  transcript: z.string(),
});
export type StructureSegment = z.infer<typeof StructureSegmentSchema>;

export const VideoAnalysisSchema = z.object({
  hookType: z.string(), // e.g. "negative-warning", "curiosity-gap"
  structureSegments: z.array(StructureSegmentSchema),
  formatTags: z.array(z.string()),
  styleTags: z.array(z.string()),
  whyItWorked: z.string(),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysisSchema>;

/**
 * A beat as it comes back OUT of the database. Identical to `StructureSegment` except
 * `transcript` may be absent: rows written before the per-beat transcript existed have
 * only a `note`, and nothing backfills them — re-analyzing the video is what fills the
 * field in. Readers render the missing case as a placeholder and never invent words.
 * The write path stays strict (`VideoAnalysisSchema` requires `transcript`), so every
 * new analysis has one.
 */
export type StoredStructureSegment = Omit<StructureSegment, "transcript"> & { transcript?: string };

/** `VideoAnalysis` with the tolerant stored beat shape. See `StoredStructureSegment`. */
export type StoredAnalysisFields = Omit<VideoAnalysis, "structureSegments"> & {
  structureSegments: StoredStructureSegment[];
};

/**
 * The video detail screen's Layout section (V1 data contracts, contract 5). Read from
 * sampled frames, never from the transcript — a transcript cannot know where on-screen
 * text sits or how often a video cuts, and a model asked to guess from words alone
 * would produce four confident sentences that are fabrications wearing the shape of a
 * reading.
 *
 * `fromFramesSec` is the anti-fabrication device: a field whose supporting frame list
 * is empty is not a reading and must not reach the screen as one. There is no frame
 * pass wired up yet (see `docs/product/frame-pass-spike-prep.md` — the configured LLM
 * client has no image-input path at all), so nothing in this codebase constructs a
 * `VideoLayout` today. The schema exists so the column and the eventual frame pass
 * agree on a shape in advance, and so `value: null` — "the pass ran and could not tell"
 * — is a distinct, honest state from "no pass has run at all" (a null `layout` column).
 */
export const VideoLayoutFieldSchema = z.object({
  /** Null means the pass ran and could not determine this field. Renders as a dash —
   *  never as an empty string, which would look like a reading that came back blank. */
  value: z.string().nullable(),
  /** Frame timestamps in seconds this reading came from. Empty means "not a reading". */
  fromFramesSec: z.array(z.number()),
});
export type VideoLayoutField = z.infer<typeof VideoLayoutFieldSchema>;

/**
 * The layout of ONE beat, keyed to that beat's timecodes so the reading lines up with
 * the story beats the analyze pass found rather than describing the whole video at once.
 * A flat whole-video reading averaged over a video whose hook is a hard-cut close-up and
 * whose payoff is a slow screen recording described neither.
 *
 * Every one of the six readings keeps its own `fromFramesSec` rather than the row
 * carrying a single shared citation. A shared citation would let one field earn the
 * frames and the other five ride along unbacked, which is the exact failure the guard
 * exists to stop.
 */
export const BeatLayoutSchema = z.object({
  /** The beat's window, copied from the analysis's `structureSegments` so the two line up. */
  startSec: z.number(),
  endSec: z.number(),
  label: z.string(),
  /** What the burned-in caption says during this beat. */
  onScreenText: VideoLayoutFieldSchema,
  /** Motion applied to the frame or its elements: zoom, whip pan, shake, none. */
  animation: VideoLayoutFieldSchema,
  /** Whether a mouse cursor is visible and what it is doing. */
  demoCursor: VideoLayoutFieldSchema,
  /** Which tool or app is on screen if this beat shows one. */
  toolDemo: VideoLayoutFieldSchema,
  /** Where the caption sits in frame. */
  textPosition: VideoLayoutFieldSchema,
  /** How fast the delivery reads from the frames: mouth activity, cut density, subtitle churn. */
  voicePace: VideoLayoutFieldSchema,
});
export type BeatLayout = z.infer<typeof BeatLayoutSchema>;

/** The stored layout: one row per beat, in beat order. */
export const VideoLayoutSchema = z.array(BeatLayoutSchema);
export type VideoLayout = z.infer<typeof VideoLayoutSchema>;

/** The six reading keys on a beat row, in the order the Layout table shows them. */
export const BEAT_LAYOUT_FIELDS = [
  "onScreenText",
  "animation",
  "demoCursor",
  "toolDemo",
  "textPosition",
  "voicePace",
] as const;

/**
 * The shape `videoAnalyses.layout` held before the layout went per beat: one flat
 * whole-video reading. Rows written by the old frame pass still hold it and nothing
 * migrates them, because a flat reading carries no beat timecodes and inventing a
 * mapping onto beats would be fabrication. Those rows show the re-run affordance.
 */
export const LegacyFlatVideoLayoutSchema = z.object({
  onScreenText: VideoLayoutFieldSchema,
  textPosition: VideoLayoutFieldSchema,
  cutRhythm: VideoLayoutFieldSchema,
  framing: VideoLayoutFieldSchema,
});
export type LegacyFlatVideoLayout = z.infer<typeof LegacyFlatVideoLayoutSchema>;

/** What a read of the `layout` column can actually be: the per-beat array, or a flat
 *  row written before the reshape. */
export type StoredVideoLayout = VideoLayout | LegacyFlatVideoLayout;

/**
 * Narrows a stored layout to the per-beat array, or null when the row predates the
 * reshape. Callers render the null case as the re-run prompt; nothing translates a flat
 * reading into beat rows.
 */
export function asBeatLayout(layout: StoredVideoLayout | null | undefined): BeatLayout[] | null {
  return Array.isArray(layout) ? layout : null;
}

export const OutlineSchema = z.object({
  beats: z.array(z.object({ label: z.string(), content: z.string(), targetSec: z.number() })),
});
export type Outline = z.infer<typeof OutlineSchema>;
