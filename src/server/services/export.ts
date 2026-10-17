import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { rowToAnalysis, type StoredVideoAnalysis } from "./analyze";
import { getNicheProfile, getRemixSession } from "./remix";
import { getSimilarOutliers } from "./similar";
import { BEAT_LAYOUT_FIELDS, asBeatLayout, type StoredAnalysisFields } from "@/server/schemas";

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

/** Beats with their verbatim per-beat transcript above the one-line summary. The absent
 *  cases are named, never filled in: a row analyzed before beats carried a transcript
 *  says so, and a beat with no words says that too. */
function beatsSection(analysis: StoredAnalysisFields | null): string {
  if (!analysis) return "No analysis for the source video yet.";
  if (analysis.structureSegments.length === 0) return "No structure segments recorded.";
  return analysis.structureSegments
    .map((segment, i) => {
      const quote =
        segment.transcript === undefined
          ? "(no per-beat transcript; re-analyze the source video)"
          : segment.transcript.trim() === ""
            ? "(no words spoken in this beat)"
            : segment.transcript;
      return [
        `${i + 1}. ${segment.label} (${segment.startSec}-${segment.endSec}s)`,
        `   transcript: ${quote}`,
        `   summary: ${segment.note}`,
      ].join("\n");
    })
    .join("\n");
}

/** The frame pass's per-beat readings. A layout written before the reshape has no beat
 *  timecodes, so it is reported as needing a re-run rather than pinned onto beats it
 *  never described. */
function layoutPerBeatSection(analysis: StoredVideoAnalysis | null): string {
  if (!analysis) return "No analysis for the source video yet.";
  const beats = asBeatLayout(analysis.layout);
  if (!beats) {
    return analysis.layout === null
      ? "(frame pass not run)"
      : "(the stored layout predates the per-beat reading; re-run the frame pass)";
  }
  return beats
    .map((beat) => {
      const fields = BEAT_LAYOUT_FIELDS.map((key) => {
        const field = beat[key];
        // Same anti-fabrication rule the UI applies: a value citing no frame is not a
        // reading, so it never reaches the prompt as one.
        const value = field.value !== null && field.fromFramesSec.length > 0 ? field.value : "—";
        return `   ${LAYOUT_FIELD_LABELS[key]}: ${value}`;
      });
      return [`- ${beat.label} (${beat.startSec}-${beat.endSec}s)`, ...fields].join("\n");
    })
    .join("\n");
}

const LAYOUT_FIELD_LABELS: Record<(typeof BEAT_LAYOUT_FIELDS)[number], string> = {
  onScreenText: "On-screen text",
  animation: "Animation",
  demoCursor: "Demo cursor",
  toolDemo: "Tool demo",
  textPosition: "Text position",
  voicePace: "Voice pace",
};

/**
 * Copy-as-Prompt scoped to a REMIX SESSION rather than to the source video.
 *
 * `buildVideoPrompt` above answers "describe this outlier", which is the right thing on
 * the video detail screen and the wrong thing at the end of a remix: by that point the
 * user has picked a hook and a script variant, and a prompt built from the source
 * analysis knows about neither. This builds from the session: the hook they chose, the
 * enriched beats and per-beat layout of the video they are remixing, and the variant
 * they picked.
 *
 * Deliberately no full source transcript. The per-beat transcript is already here, in
 * the beats section, split the way the remix will be shot; dumping the raw blob again
 * would bury the chosen script under the source's own words.
 *
 * Returns null only when the session does not exist. Every missing piece inside a real
 * session (no hook chosen, no variant picked, no frame pass) renders as a named absence.
 */
export async function buildRemixPrompt(sessionId: string): Promise<string | null> {
  const session = await getRemixSession(sessionId);
  if (!session) return null;

  const [videoRow] = await db
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
    .where(eq(tables.videos.id, session.sourceVideoId))
    .limit(1);

  const [analysisRow] = await db
    .select()
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, session.sourceVideoId))
    .limit(1);
  const analysis = analysisRow ? rowToAnalysis(analysisRow) : null;

  const niche = await getNicheProfile();

  const variants = session.variants ?? [];
  const chosenIndex = session.chosenVariantIndex;
  // No fallback to variants[0]. A prompt that presents an unchosen variant as "the
  // chosen script" is a fabrication with a confident label on it.
  const chosenVariant = chosenIndex !== null && chosenIndex >= 0 ? (variants[chosenIndex] ?? null) : null;

  return [
    `# Remix prompt — ${session.topic ?? videoRow?.caption ?? "(untitled remix)"}`,
    "",
    "## Source outlier",
    videoRow
      ? metricsSection({
          channelHandle: videoRow.channelHandle,
          viewCount: videoRow.viewCount,
          outlierScore: videoRow.outlierScore,
          durationSec: videoRow.durationSec,
          postedAt: videoRow.postedAt,
        })
      : "(the source video row is gone)",
    videoRow?.caption ? `- Caption: ${videoRow.caption}` : "- Caption: (none)",
    `- Niche: ${niche}`,
    "",
    "## Chosen hook",
    session.chosenHook ?? "(no hook chosen)",
    "",
    "## Beats",
    beatsSection(analysis),
    "",
    "## Layout per beat",
    layoutPerBeatSection(analysis),
    "",
    "## Script",
    chosenVariant ??
      (variants.length > 0
        ? `(no variant picked; ${variants.length} written. Open the one you want on the Script stage.)`
        : "(no script variant written yet)"),
    "",
    `## Target length\n${session.targetLengthSec !== null ? `${session.targetLengthSec}s` : "(not set)"}`,
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
