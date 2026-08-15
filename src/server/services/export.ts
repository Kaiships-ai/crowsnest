import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { rowToAnalysis } from "./analyze";
import { getNicheProfile } from "./remix";
import { getSimilarOutliers } from "./similar";
import type { StoredAnalysisFields } from "@/server/llm/schemas";

/**
 * Copy-as-Prompt (Task 7, spec §8): one structured markdown block — topic framing,
 * hook strategy, structure beats, style notes, research facts, source metrics — that
 * a user can paste into any LLM. Every section degrades gracefully when its underlying
 * data is missing (most commonly: no analysis yet) rather than omitting the section,
 * so the document's shape is stable whether or not the video's been analyzed.
 */

interface SourceMetrics {
  channelHandle: string;
  viewCount: number | null;
  outlierScore: number | null;
  durationSec: number | null;
  postedAt: string;
}

function metricsSection(metrics: SourceMetrics): string {
  return [
    `- Channel: ${metrics.channelHandle}`,
    `- Views: ${metrics.viewCount !== null ? formatCompact(metrics.viewCount) : "unknown"}`,
    `- Outlier multiplier: ${formatMultiplier(metrics.outlierScore)}`,
    `- Duration: ${metrics.durationSec !== null ? `${metrics.durationSec}s` : "unknown"}`,
    `- Posted: ${metrics.postedAt}`,
  ].join("\n");
}

function hookSection(analysis: StoredAnalysisFields | null): string {
  if (!analysis) return "Analysis pending — analyze this video first for a grounded hook strategy.";
  const firstBeat = analysis.structureSegments[0];
  return firstBeat ? `${analysis.hookType} — ${firstBeat.note}` : analysis.hookType;
}

function structureSection(analysis: StoredAnalysisFields | null): string {
  if (!analysis) return "Analysis pending.";
  if (analysis.structureSegments.length === 0) return "No structure segments recorded.";
  return analysis.structureSegments
    .map((segment, i) => `${i + 1}. ${segment.label} (${segment.startSec}-${segment.endSec}s): ${segment.note}`)
    .join("\n");
}

function styleSection(analysis: StoredAnalysisFields | null): string {
  if (!analysis) return "Analysis pending.";
  const parts: string[] = [];
  if (analysis.formatTags.length > 0) parts.push(`Format: ${analysis.formatTags.join(", ")}`);
  if (analysis.styleTags.length > 0) parts.push(`Style: ${analysis.styleTags.join(", ")}`);
  return parts.length > 0 ? parts.join(". ") : "No format/style tags recorded.";
}

interface SimilarFact {
  channelHandle: string;
  caption: string | null;
  outlierScore: number | null;
}

function researchSection(analysis: StoredAnalysisFields | null, similar: SimilarFact[]): string {
  const lines: string[] = [];
  lines.push(analysis ? `Why it worked: ${analysis.whyItWorked}` : "Analysis pending.");
  if (similar.length > 0) {
    lines.push(
      "Similar tracked outliers:",
      ...similar.map((s) => `- ${s.channelHandle} (${formatMultiplier(s.outlierScore)})${s.caption ? ` — ${s.caption}` : ""}`)
    );
  }
  return lines.join("\n");
}

const FOOTER =
  "---\n\nPaste this into any LLM to draft your own version, or use Crowsnest's Remix Studio for a guided 5-stage flow.";

/**
 * Builds a Copy-as-Prompt markdown block for a video. Returns `null` only when the
 * video itself doesn't exist — a missing *analysis* degrades each section's content
 * instead (see hookSection/structureSection/styleSection/researchSection above).
 */
export async function buildVideoPrompt(videoId: string): Promise<string | null> {
  const [row] = await db
    .select({
      caption: tables.videos.caption,
      viewCount: tables.videos.viewCount,
      outlierScore: tables.videos.outlierScore,
      durationSec: tables.videos.durationSec,
      postedAt: tables.videos.postedAt,
      channelHandle: tables.channels.handle,
    })
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(eq(tables.videos.id, videoId))
    .limit(1);
  if (!row) return null;

  const [analysisRow] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
  const analysis = analysisRow ? rowToAnalysis(analysisRow) : null;

  const [transcriptRow] = await db
    .select({ text: tables.transcripts.text })
    .from(tables.transcripts)
    .where(eq(tables.transcripts.videoId, videoId))
    .limit(1);

  const [niche, similarOutliers] = await Promise.all([getNicheProfile(), getSimilarOutliers(videoId, 5)]);
  const similar: SimilarFact[] = similarOutliers.map((item) => ({
    channelHandle: item.channel.handle,
    caption: item.caption,
    outlierScore: item.outlierScore,
  }));

  const topic = row.caption ?? "(untitled video)";

  return [
    `# Copy-as-Prompt — ${topic}`,
    "",
    "## Topic framing",
    `${topic}`,
    `Niche: ${niche}`,
    "",
    "## Hook strategy",
    hookSection(analysis),
    "",
    "## Structure beats",
    structureSection(analysis),
    "",
    "## Style notes",
    styleSection(analysis),
    "",
    "## Research facts",
    researchSection(analysis, similar),
    "",
    "## Source metrics",
    metricsSection({ channelHandle: row.channelHandle, viewCount: row.viewCount, outlierScore: row.outlierScore, durationSec: row.durationSec, postedAt: row.postedAt }),
    "",
    "## Transcript",
    transcriptRow?.text ?? "No transcript available.",
    "",
    FOOTER,
  ].join("\n");
}

/**
 * Builds a Copy-as-Prompt markdown block for a saved script — its hook/style Vault
 * templates (if linked), and its source video's analysis/metrics (if linked and
 * analyzed), alongside the script's own content. Returns `null` only when the script
 * itself doesn't exist.
 */
export async function buildScriptPrompt(scriptId: string): Promise<string | null> {
  const [script] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId)).limit(1);
  if (!script) return null;

  let hookTemplate: string | null = null;
  if (script.hookVaultItemId) {
    const [v] = await db
      .select({ templateText: tables.vaultItems.templateText })
      .from(tables.vaultItems)
      .where(eq(tables.vaultItems.id, script.hookVaultItemId))
      .limit(1);
    hookTemplate = v?.templateText ?? null;
  }

  let styleTemplate: string | null = null;
  let styleTags: string[] = [];
  if (script.styleVaultItemId) {
    const [v] = await db.select().from(tables.vaultItems).where(eq(tables.vaultItems.id, script.styleVaultItemId)).limit(1);
    styleTemplate = v?.templateText ?? null;
    styleTags = v?.tags ?? [];
  }

  let analysis: StoredAnalysisFields | null = null;
  let sourceMetricsText = "No source video linked.";
  if (script.sourceVideoId) {
    const [video] = await db
      .select({
        viewCount: tables.videos.viewCount,
        outlierScore: tables.videos.outlierScore,
        durationSec: tables.videos.durationSec,
        postedAt: tables.videos.postedAt,
        channelHandle: tables.channels.handle,
      })
      .from(tables.videos)
      .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
      .where(eq(tables.videos.id, script.sourceVideoId))
      .limit(1);
    if (video) sourceMetricsText = metricsSection(video);

    const [analysisRow] = await db
      .select()
      .from(tables.videoAnalyses)
      .where(eq(tables.videoAnalyses.videoId, script.sourceVideoId))
      .limit(1);
    analysis = analysisRow ? rowToAnalysis(analysisRow) : null;
  }

  return [
    `# Copy-as-Prompt — ${script.title}`,
    "",
    "## Topic framing",
    script.title,
    "",
    "## Hook strategy",
    hookTemplate ?? (analysis ? hookSection(analysis) : "No hook template linked — see script content below."),
    "",
    "## Structure beats",
    styleTemplate ?? (analysis ? structureSection(analysis) : "No style template linked — see script content below."),
    "",
    "## Style notes",
    styleTags.length > 0 ? `Style: ${styleTags.join(", ")}` : styleSection(analysis),
    "",
    "## Research facts",
    analysis ? researchSection(analysis, []) : "Analysis pending.",
    "",
    "## Source metrics",
    sourceMetricsText,
    "",
    "## Script",
    script.content,
    "",
    FOOTER,
  ].join("\n");
}
