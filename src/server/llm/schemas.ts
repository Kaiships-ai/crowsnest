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

export const VideoAnalysisSchema = z.object({
  hookType: z.string(), // e.g. "negative-warning", "curiosity-gap"
  structureSegments: z.array(
    z.object({ label: z.string(), startSec: z.number(), endSec: z.number(), note: z.string() })
  ),
  formatTags: z.array(z.string()),
  styleTags: z.array(z.string()),
  whyItWorked: z.string(),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysisSchema>;

export const HookOptionsSchema = z.object({ hooks: z.array(z.string()).min(3).max(7) });
export type HookOptions = z.infer<typeof HookOptionsSchema>;

export const OutlineSchema = z.object({
  beats: z.array(z.object({ label: z.string(), content: z.string(), targetSec: z.number() })),
});
export type Outline = z.infer<typeof OutlineSchema>;
