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

  // The remix half. Present only when the plan came out of a remix session, because
  // there is nothing to say otherwise and a "## Hook" heading over "(none)" on a
  // hand-made plan would imply a hook was chosen and lost.
  if (remix) {
    lines.push("## Hook");
    lines.push(remix.session.chosenHook ?? "(no hook chosen in the remix)");
    lines.push("");

    lines.push("## Beats");
    const segments = remix.sourceAnalysis?.structureSegments ?? [];
    if (segments.length === 0) {
      lines.push("(the remixed video has no analyzed beats)");
      lines.push("");
    } else {
      for (const segment of segments) {
        lines.push(`### ${segment.label} (${segment.startSec}s to ${segment.endSec}s)`);
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

  lines.push("## Source outlier");
  if (video) {
    lines.push(`- Channel: @${video.item.channel.handle}`);
    lines.push(`- URL: ${video.item.url}`);
    lines.push(`- Caption: ${video.item.caption ?? "(no caption)"}`);
    lines.push(`- Outlier score: ${video.item.outlierScore ?? "(not scored)"}`);
    lines.push(`- Views: ${video.item.viewCount ?? "(unknown)"}`);
    if (video.transcript) {
      lines.push("", "Transcript:", "", video.transcript.text);
    }
  } else {
    lines.push("(no source video)");
  }
  lines.push("");

  lines.push("## Script");
  if (plan.scriptContent !== null) {
    lines.push(`- Title: ${plan.scriptTitle ?? "Untitled script"}`);
    lines.push(`- Length: ${plan.scriptLengthChars !== null ? `${plan.scriptLengthChars} chars` : "(unknown)"}`);
    lines.push("", plan.scriptContent);
  } else if (plan.scriptDetachedNote) {
    lines.push(`(script detached: ${plan.scriptDetachedNote})`);
  } else {
    lines.push("(no script attached)");
  }
  lines.push("");

  lines.push("## Target length");
  lines.push(plan.targetLengthSec !== null ? `${plan.targetLengthSec}s` : "(not set)");
  lines.push("");

  lines.push("## Video kind");
  lines.push(plan.videoKind ?? "(not set)");
  lines.push("");

  lines.push("## Layout per beat");
  // One block per story beat. `asBeatLayout` returns null for a row written before the
  // layout went per beat: that flat reading has no beat timecodes, so it is reported as
  // absent rather than pinned onto beats it never described.
  //
  // The remix's own source analysis wins when there is one, so the layout describes the
  // same video as the Beats section above rather than drifting to the plan's video if a
  // hand edit ever separated the two.
  const beats = asBeatLayout(remix?.sourceAnalysis?.layout ?? video?.analysis?.layout);
  if (beats) {
    for (const beat of beats) {
      lines.push(`### ${beat.label} (${beat.startSec}s to ${beat.endSec}s)`);
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
