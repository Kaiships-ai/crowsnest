import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, tables } from "@/server/db";
import {
  VideoAnalysisSchema,
  type StoredAnalysisFields,
  type StoredVideoLayout,
} from "@/server/schemas";

/**
 * `VideoAnalysisSchema` plus `summary` (B-10). `summary` is kept out of
 * `VideoAnalysisSchema` itself rather than added there: that schema is also the
 * `VideoAnalysis` type remix.ts and `rowToAnalysis` build on, and widening it would force
 * every one of those (which have no use for a video-level summary) to carry the field
 * too. `summary` stays optional so an agent that saves an analysis without one behaves
 * exactly as before; when it is sent, this is now the only thing that persists it, so the
 * video detail page's Summary section (`video-detail.tsx`) actually has something to show.
 */
const AgentAnalysisSchema = VideoAnalysisSchema.extend({ summary: z.string().optional() });

/**
 * `VideoAnalysis` plus the Layout section's provenance columns (V1 data contracts,
 * contract 5). Kept as a separate, wider type rather than folding layout into
 * `VideoAnalysis` itself: `VideoAnalysisSchema` is validated 1:1 against what the text
 * model returns, and the text model never produces layout — a frame pass does, on a
 * separate row update, with its own model and its own timestamp. Every caller that only
 * wants hook/structure/format/style/why (remix.ts's prompt building) still gets a valid
 * `VideoAnalysis` for free, since this type is a strict superset.
 */
export interface StoredVideoAnalysis extends StoredAnalysisFields {
  /** Null until a frame pass has run. Never partially fabricated from the transcript —
   *  see the doc comment on `videoAnalyses.layout` in schema.ts. */
  layout: StoredVideoLayout | null;
  framesSampled: number | null;
  frameModel: string | null;
  framePassAt: string | null;
  framePassError: string | null;
}

// Exported for reuse by remix.ts (Task 5), which needs the same video_analyses row ->
// VideoAnalysis mapping to describe the source video's hook/structure to Claude.
export function rowToAnalysis(row: typeof tables.videoAnalyses.$inferSelect): StoredVideoAnalysis {
  return {
    hookType: row.hookType ?? "",
    structureSegments: row.structureSegments ?? [],
    formatTags: row.formatTags ?? [],
    styleTags: row.styleTags ?? [],
    whyItWorked: row.whyItWorked ?? "",
    layout: row.layout ?? null,
    framesSampled: row.framesSampled ?? null,
    frameModel: row.frameModel ?? null,
    framePassAt: row.framePassAt ?? null,
    framePassError: row.framePassError ?? null,
  };
}

/**
 * Save an analysis the AGENT authored (through crowsnest_save_analysis), not one the
 * in-app model produced. Validates the fields against the same VideoAnalysisSchema the
 * in-app path validates, then upserts the video_analyses row stamped source="mcp". Never
 * calls the LLM. Returns a result object rather than throwing, for the MCP boundary.
 */
export async function saveAgentAnalysis(
  videoId: string,
  fields: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [video] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  if (!video) return { ok: false, error: "video not found" };

  const parsed = AgentAnalysisSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const a = parsed.data;

  const textFields = {
    hookType: a.hookType,
    structureSegments: a.structureSegments,
    formatTags: a.formatTags,
    styleTags: a.styleTags,
    whyItWorked: a.whyItWorked,
    source: "mcp" as const,
  };

  const [existing] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
  if (existing) {
    // `summary` is omitted from the SET entirely when the payload doesn't carry one, so a
    // re-save without a summary can't null out one stored by an earlier save. An explicit
    // "" still clears it, since that's a defined value distinct from undefined.
    const update = a.summary !== undefined ? { ...textFields, summary: a.summary } : textFields;
    await db.update(tables.videoAnalyses).set(update).where(eq(tables.videoAnalyses.videoId, videoId));
  } else {
    await db.insert(tables.videoAnalyses).values({ videoId, ...textFields, summary: a.summary ?? null, createdAt: nowIso() });
  }
  return { ok: true };
}
