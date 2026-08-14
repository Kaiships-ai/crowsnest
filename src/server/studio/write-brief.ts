import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStudioBrief } from "@/server/queries/studio";
import type { VideoLayoutField } from "@/server/llm/schemas";

/** "value (t=1.2s, 3.4s)" for a reading, or a dash for "the pass ran and could not
 *  tell" -- same distinction LayoutField in studio-screen.tsx renders, just as text. */
function formatLayoutField(field: VideoLayoutField): string {
  if (field.value === null) return "—";
  if (field.fromFramesSec.length === 0) return field.value;
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
 * Throws if `postId` resolves to no plan at all (nothing to write) or if the write
 * itself fails; the caller (ws.ts's fresh-spawn path) is the one that decides a
 * brief-write failure must not crash the attach, so it owns the try/catch.
 */
export async function writeBrief(dir: string, postId: string): Promise<void> {
  const brief = await getStudioBrief(postId);
  if (!brief) {
    throw new Error(`writeBrief: no plan found for postId ${postId}`);
  }
  const { plan, video } = brief;

  const lines: string[] = [];
  lines.push(`# Cook brief: ${plan.title}`, "");

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
  if (plan.scriptId) {
    lines.push(`- Title: ${plan.scriptTitle ?? "Untitled script"}`);
    lines.push(`- Length: ${plan.scriptLengthChars !== null ? `${plan.scriptLengthChars} chars` : "(unknown)"}`);
    // getStudioBrief carries only the script's title/length (PlannedPostRow's
    // denormalized columns), not its body text -- there is no script content in
    // this object to print here.
    lines.push("- Body: (not available -- getStudioBrief carries only the script's title and length, not its content)");
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

  lines.push("## Frame-pass layout");
  const layout = video?.analysis?.layout ?? null;
  if (layout) {
    lines.push(`- On-screen text: ${formatLayoutField(layout.onScreenText)}`);
    lines.push(`- Text position: ${formatLayoutField(layout.textPosition)}`);
    lines.push(`- Cut rhythm: ${formatLayoutField(layout.cutRhythm)}`);
    lines.push(`- Framing: ${formatLayoutField(layout.framing)}`);
  } else {
    lines.push("(frame pass not run)");
  }
  lines.push("");

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "brief.md"), lines.join("\n"), "utf8");
}
