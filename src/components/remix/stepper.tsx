"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RemixStage } from "@/server/services/remix";

export const STAGES: { key: RemixStage; label: string }[] = [
  { key: "prompt", label: "Prompt" },
  { key: "research", label: "Research" },
  { key: "hook", label: "Hook" },
  { key: "style", label: "Style" },
  { key: "script", label: "Script" },
  { key: "finish", label: "Finish" },
];

export const STAGE_ORDER: RemixStage[] = STAGES.map((stage) => stage.key);

/**
 * DESIGN.md §2.5: numbered segments joined by a hairline. Current stage gets the
 * `--primary` fill; completed stages get a success checkmark and stay clickable to
 * jump back and edit; future stages are dimmed and not clickable until reached. No
 * shadcn primitive covers this — built from Separator + styled buttons per the spec.
 */
export function Stepper({
  activeStage,
  furthestStage,
  onSelect,
}: {
  activeStage: RemixStage;
  furthestStage: RemixStage;
  onSelect: (stage: RemixStage) => void;
}) {
  const furthestIndex = STAGE_ORDER.indexOf(furthestStage);
  const activeIndex = STAGE_ORDER.indexOf(activeStage);

  return (
    <div className="flex items-center">
      {STAGES.map((stage, i) => {
        const reachable = i <= furthestIndex;
        const completed = i < furthestIndex;
        const isActive = i === activeIndex;
        return (
          <div key={stage.key} className={cn("flex items-center", i < STAGES.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(stage.key)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                // Raised surface, never amber — active stage is a position marker, not
                // the screen's one primary action (brief: progress bars/nav state ban amber).
                "flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
                isActive && "bg-popover text-foreground",
                !isActive && reachable && "text-foreground hover:bg-muted",
                !reachable && "text-muted-foreground/50"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-2xs tabular-nums",
                  isActive && "border-foreground/50",
                  completed && "border-transparent bg-[var(--pos)] text-background",
                  !isActive && !completed && "border-current"
                )}
              >
                {completed ? <Check className="size-3" /> : i + 1}
              </span>
              {stage.label}
            </button>
            {i < STAGES.length - 1 && (
              <div
                aria-hidden
                className={cn(
                  // Neutral only — a connector is progress, banned from amber and
                  // from the pos green (DESIGN.md Amber Law + Two-Hue Rule). A reached
                  // segment steps up to the strong rule weight; the rest stay hairline.
                  "mx-1 h-px flex-1 transition-colors duration-200 motion-reduce:transition-none",
                  i < furthestIndex ? "bg-line-strong" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
