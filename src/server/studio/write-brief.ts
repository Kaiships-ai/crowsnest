import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStudioBrief } from "@/server/queries/studio";
import { getPersona } from "@/server/services/persona";
import { BEAT_LAYOUT_FIELDS, asBeatLayout, type VideoLayoutField } from "@/server/llm/schemas";

const LAYOUT_FIELD_LABELS: Record<(typeof BEAT_LAYOUT_FIELDS)[number], string> = {
  onScreenText: "On-screen text",
  animation: "Animation",
  demoCursor: "Demo cursor",
  toolDemo: "Tool demo",
  textPosition: "Text position",
  voicePace: "Voice pace",
};

/**
 * "value (frames: 1.2s, 3.4s)" for a reading, or a dash. Same anti-fabrication rule the
 * two other readers apply (export.ts's `layoutPerBeatSection`, layout-section.tsx's
 * `fieldValue`): a value that names no source frame is not a reading, so it renders as a
 * dash rather than as a fact the cook would then build on.
 *
 * `persistFramePass` already refuses to store that combination, so this is unreachable
 * for validated data. It is written this way anyway because this is the reader that feeds
 * a cook, and of the three it is the one where a slipped invariant would do real damage:
 * the other two put an uncited value on a screen a human is reading, this one puts it in
 * a brief a model treats as ground truth.
 */
function formatLayoutField(field: VideoLayoutField): string {
  if (field.value === null || field.fromFramesSec.length === 0) return "—";
  return `${field.value} (frames: ${field.fromFramesSec.join("s, ")}s)`;
}

/**
 * Serializes the studio brief (content machine v1, task 2's `getStudioBrief`) to
 * markdown for the cook to read as `./brief.md` (E2/E3 task 4). Every section is
 * built from a field that actually exists on `PlannedPostRow` or `VideoDetail` --
 * there is no plan-level hook/angle/outline/research-notes column today (those were
 * a proposed shape in the task brief, not a real one), so this deliberately omits
 * them rather than printing an invented value. See task-4-report.md for the list of
 * proposed sections with no backing field.
 *
 * Fix round 1: `plan.scriptContent` (planned-posts.ts) carries the attached script's
 * full body text -- the same `scripts.content` row `getPlannedPostById` already
 * selects to compute `scriptLengthChars`, just no longer discarded after that.
 *
 * Throws if `postId` resolves to no plan at all (nothing to write) or if the write
 * itself fails; the caller (ws.ts's fresh-spawn path) is the one that decides a
 * brief-write failure must not crash the attach, so it owns the try/catch.
 */
export async function writeBrief(dir: string, postId: string): Promise<void> {
  const brief = await getStudioBrief(postId);
  if (!brief) {
    throw new Error(`writeBrief: no plan found for postId ${postId}`);
  }
  const { plan, video, remix } = brief;
  // Called directly (persona.ts) rather than folded into getStudioBrief's query, per
  // the spec: the query stays unchanged, and this reader already prefers direct calls
  // (see the Layout-per-beat comment below) over reshaping what it's handed.
  const persona = await getPersona();

  const lines: string[] = [];
  lines.push(`# Cook brief: ${plan.title}`, "");

  // The final script goes FIRST and clearly labelled: it is the deliverable, everything
  // below is source reference. Prefer the remix session's chosen variant over the
  // plan's attached script row: the variant is what the studio's Finish screen shows and
  // what the user last picked (opening a variant tab and editing it both persist to
  // `variants`/`chosenVariantIndex`), whereas the attached script row only updates on an
  // explicit Save. Regenerating the remix without re-saving left the plan pointing at a
  // stale script, so the cook read a script the user never chose. The attached script is
  // the fallback for a hand-made plan with no remix.
  const chosenVariant =
    remix && remix.session.chosenVariantIndex !== null
      ? (remix.session.variants?.[remix.session.chosenVariantIndex] ?? null)
      : null;

  lines.push("## Your script");
  if (remix?.session.chosenHook) {
    lines.push(`- Hook: ${remix.session.chosenHook}`);
  }
  if (plan.targetLengthSec !== null) lines.push(`- Target length: ${plan.targetLengthSec}s`);
  if (plan.videoKind) lines.push(`- Video kind: ${plan.videoKind}`);

  if (chosenVariant !== null) {
    lines.push(`- Length: ${chosenVariant.length} chars`);
    lines.push("", chosenVariant);
  } else if (plan.scriptContent !== null) {
    lines.push(`- Title: ${plan.scriptTitle ?? "Untitled script"}`);
    lines.push(`- Length: ${plan.scriptLengthChars !== null ? `${plan.scriptLengthChars} chars` : "(unknown)"}`);
    lines.push("", plan.scriptContent);
  } else if (remix) {
    lines.push("", "(no variant picked yet in the remix; open the Script stage and pick one)");
  } else if (plan.scriptDetachedNote) {
    lines.push("", `(script detached: ${plan.scriptDetachedNote})`);
  } else {
    lines.push("", "(no script attached)");
  }
  lines.push("");

  // Same optional-line shape `withPersona` (remix.ts) uses for the generation prompts:
  // each field is skipped when empty, and the whole section is skipped when nothing is
  // set, rather than printing a "## Persona" heading over nothing to say.
  const personaLines: string[] = [];
  if (persona.audience) personaLines.push(`- Audience: ${persona.audience}`);
  if (persona.voice) personaLines.push(`- Voice: ${persona.voice}`);
  if (persona.do) personaLines.push(`- Do: ${persona.do}`);
  if (persona.dont) personaLines.push(`- Don't: ${persona.dont}`);
  if (personaLines.length > 0) {
    lines.push("## Persona", ...personaLines, "");
  }

  // Everything below is the source outlier, not the deliverable. One heading plus a
  // one-line framing so the reader never mistakes the reference for the output.
  lines.push("## Source reference");
  lines.push("Everything below describes the ORIGINAL video this remix is based on, for reference. Your script is the section above.", "");

  const segments = remix?.sourceAnalysis?.structureSegments ?? [];
  // The per-beat transcripts ARE the source's spoken words, sliced by beat. When they
  // exist, the flat whole-video transcript below is the same words a second time, so it
  // is dropped. It stays only as the fallback for a video analyzed before per-beat
  // transcripts existed (no beat carries one).
  const beatsHaveWords = segments.some((s) => s.transcript !== undefined && s.transcript.trim() !== "");

  lines.push("### Source outlier");
  if (video) {
    // Normalize to exactly one leading "@": some stored handles already carry it
    // ("@nick_saraev"), some do not, and blindly prefixing produced "@@handle".
    lines.push(`- Channel: @${video.item.channel.handle.replace(/^@+/, "")}`);
    lines.push(`- URL: ${video.item.url}`);
    lines.push(`- Caption: ${video.item.caption ?? "(no caption)"}`);
    lines.push(`- Outlier score: ${video.item.outlierScore ?? "(not scored)"}`);
    lines.push(`- Views: ${video.item.viewCount ?? "(unknown)"}`);
    if (video.transcript && !beatsHaveWords) {
      lines.push("", "Transcript:", "", video.transcript.text);
    }
  } else {
    lines.push("(no source video)");
  }
  lines.push("");

  if (remix) {
    lines.push("### Original beats (source video)");
    if (segments.length === 0) {
      lines.push("(the remixed video has no analyzed beats)");
      lines.push("");
    } else {
      for (const segment of segments) {
        lines.push(`#### ${segment.label} (${segment.startSec}s to ${segment.endSec}s)`);
        // Absent and empty are different facts and neither is filled in: a beat analyzed
        // before the per-beat transcript existed has no words recorded, and a beat that
        // covers silence genuinely has none.
        lines.push(
          `- Transcript: ${
            segment.transcript === undefined
              ? "(not captured; re-analyze the source video)"
              : segment.transcript.trim() === ""
                ? "(no words spoken in this beat)"
                : segment.transcript
          }`
        );
        lines.push(`- Summary: ${segment.note}`);
        lines.push("");
      }
    }
  }

  lines.push("### Original layout per beat (source video)");
  // One block per story beat. `asBeatLayout` returns null for a row written before the
  // layout went per beat: that flat reading has no beat timecodes, so it is reported as
  // absent rather than pinned onto beats it never described.
  //
  // The remix's own source analysis wins when there is one, so the layout describes the
  // same video as the Source beats section above rather than drifting to the plan's video
  // if a hand edit ever separated the two.
  const beats = asBeatLayout(remix?.sourceAnalysis?.layout ?? video?.analysis?.layout);
  if (beats) {
    for (const beat of beats) {
      lines.push(`#### ${beat.label} (${beat.startSec}s to ${beat.endSec}s)`);
      for (const key of BEAT_LAYOUT_FIELDS) {
        lines.push(`- ${LAYOUT_FIELD_LABELS[key]}: ${formatLayoutField(beat[key])}`);
      }
      lines.push("");
    }
  } else {
    lines.push("(frame pass not run)");
    lines.push("");
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "brief.md"), lines.join("\n"), "utf8");
}
