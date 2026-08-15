"use client";

import Link from "next/link";

import { formatMultiplier } from "@/lib/format";
import { StudioPanel } from "@/components/studio/studio-panel";
import { BEAT_LAYOUT_FIELDS, asBeatLayout, type VideoLayoutField } from "@/server/llm/schemas";
import { formatDuration } from "@/lib/format";
import type { getStudioBrief } from "@/server/queries/studio";

type StudioBrief = NonNullable<Awaited<ReturnType<typeof getStudioBrief>>>;

/** Radius-0 amber score badge, matching idea-inbox.tsx's own local `ScoreBadge` rather
 *  than the feed's rounded `OutlierBadge` — the studio shell follows DESIGN-SYSTEM.md
 *  §5's radius-0-on-badges rule to the letter, same as that one does. Amber wash/border/
 *  text per §3's amber law; nothing else in this screen is amber (Publish stays neutral
 *  until a render exists), which keeps the law satisfied for this shell state. */
function ScoreBadge({ score }: { score: number | null }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center border border-score-line bg-score-wash px-2 py-0.5 font-mono text-2xs font-medium tabular-nums text-score">
      {formatMultiplier(score)} score
    </span>
  );
}

/** One row of the frame pass's Layout section (contract 5). `field.value === null` means
 *  the pass ran and could not read this field — still renders as a dash, same "a dash
 *  means the pass ran and came back empty" rule the field's own schema comment sets, not
 *  as an empty string that would look indistinguishable from a positive blank reading. */
const FIELD_LABELS: Record<(typeof BEAT_LAYOUT_FIELDS)[number], string> = {
  onScreenText: "On-screen text",
  animation: "Animation",
  demoCursor: "Demo cursor",
  toolDemo: "Tool demo",
  textPosition: "Text position",
  voicePace: "Voice pace",
};

function LayoutField({ label, field }: { label: string; field: VideoLayoutField }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0">
      <span className="font-mono text-2xs tracking-wide text-faint uppercase">{label}</span>
      <span className="text-sm text-foreground">{field.value ?? "—"}</span>
    </div>
  );
}

/**
 * The studio shell (content machine v1, task 3): a full-bleed three-pane screen for one
 * planned post. Brief (left) is real, populated from `getStudioBrief`'s plan + source
 * video. Claude Code (center) and Output (right) are deliberately inert placeholders —
 * later plans wire a real terminal connection and a real render pipeline into these same
 * panes, so this task builds neither a fake terminal transcript nor a fake video player,
 * only the labelled slots they will land in.
 */
export function StudioScreen({ brief }: { brief: StudioBrief }) {
  const { plan, video } = brief;
  // The per-beat rows, or null when no pass has run or the row is the old flat shape
  // (which carries no beat timecodes and is not reshaped into beats it never described).
  const beats = asBeatLayout(video?.analysis?.layout);

  return (
    <div className="flex h-full">
      {/* Left: Brief */}
      <div className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-6">
        <div>
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Brief</span>
          <h2 className="mt-1 text-lg font-medium text-foreground">{plan.title}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {plan.videoKind && (
            <span className="inline-flex w-fit items-center border border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground uppercase">
              {plan.videoKind}
            </span>
          )}
          {video && <ScoreBadge score={video.item.outlierScore} />}
        </div>

        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Script</span>
          {plan.scriptId ? (
            <p className="text-sm text-foreground">{plan.scriptTitle ?? "Untitled script"}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No script attached.</p>
          )}
          {plan.sourceVideoId && (
            <Link
              href={`/feed/${plan.sourceVideoId}`}
              className="w-fit text-xs text-muted-foreground underline hover:text-foreground"
            >
              source outlier
            </Link>
          )}
        </div>

        <div className="flex flex-col border-t border-border pt-4">
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Visual direction</span>
          {beats ? (
            <div className="mt-2 flex flex-col gap-4">
              {beats.map((beat, i) => (
                <div key={i} className="flex flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{beat.label}</span>
                    <span className="font-mono text-2xs text-faint">
                      {formatDuration(beat.startSec)}–{formatDuration(beat.endSec)}
                    </span>
                  </div>
                  {BEAT_LAYOUT_FIELDS.map((key) => (
                    <LayoutField key={key} label={FIELD_LABELS[key]} field={beat[key]} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Frame pass not run.</p>
          )}
        </div>
      </div>

      <StudioPanel postId={plan.id} hasFramePass={beats !== null} />
    </div>
  );
}
