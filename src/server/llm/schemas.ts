import { z } from "zod";

/**
 * Structured-output schemas for every Claude call in the AI half of the product
 * (Task 1 of docs/superpowers/plans/2026-07-24-phase3-remix-vault.md). Each is passed
 * to `LlmClient.generateParsed` via `zodOutputFormat` (see client.ts) — the SDK
 * guarantees the parsed result matches the shape below, or client.ts throws
 * `LlmParseError` after one retry. Keep these in sync with the prompts that target
 * them (analyze-prompt.ts, remix-prompts.ts describe the shape in prose; these
 * `z.object`s are the enforced contract).
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

export const VideoLayoutSchema = z.object({
  onScreenText: VideoLayoutFieldSchema,
  textPosition: VideoLayoutFieldSchema,
  cutRhythm: VideoLayoutFieldSchema,
  framing: VideoLayoutFieldSchema,
});
export type VideoLayout = z.infer<typeof VideoLayoutSchema>;

export const HookOptionsSchema = z.object({ hooks: z.array(z.string()).min(3).max(7) });
export type HookOptions = z.infer<typeof HookOptionsSchema>;

export const OutlineSchema = z.object({
  beats: z.array(z.object({ label: z.string(), content: z.string(), targetSec: z.number() })),
});
export type Outline = z.infer<typeof OutlineSchema>;

/** One generated content idea (ideas loop, task 7): a one-line `concept` plus a short
 *  `angle` explaining the spin — see `services/ideas.ts`'s `generateIdea`. */
export const IdeaSchema = z.object({ concept: z.string(), angle: z.string() });
export type Idea = z.infer<typeof IdeaSchema>;
