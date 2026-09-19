"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
 * DESIGN.md §2.5: numbered segments, one per stage. A `ButtonGroup` rather than
 * `Tabs`, because selecting a segment moves the whole wizard to that stage instead of
 * swapping a panel in place, and because a stage past the furthest one reached is not
 * selectable at all. Completed stages get a success checkmark and stay clickable to
 * jump back and edit; future stages are disabled until reached.
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
    // Six labelled segments do not fit a phone; the group scrolls sideways rather than
    // wrapping, which would break the joined rounding ButtonGroup relies on.
    <div className="overflow-x-auto">
      <ButtonGroup>
        {STAGES.map((stage, i) => {
          const reachable = i <= furthestIndex;
          const completed = i < furthestIndex;
          const isActive = i === activeIndex;
          return (
            <Button
              key={stage.key}
              variant="ghost"
              disabled={!reachable}
              onClick={() => onSelect(stage.key)}
              aria-current={isActive ? "step" : undefined}
              // The active segment is a position marker, so `aria-current` carries both
              // the semantics and the only tone this row gets. It is deliberately not
              // the emphasized variant: the footer's Continue is the one primary action
              // on the screen, and a stepper segment is navigation, not a decision.
              className="aria-[current=step]:bg-muted aria-[current=step]:text-foreground"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-2xs tabular-nums",
                  completed ? "border-transparent bg-[var(--success)] text-background" : "border-current"
                )}
              >
                {completed ? <Check className="size-3" /> : i + 1}
              </span>
              {stage.label}
            </Button>
          );
        })}
      </ButtonGroup>
    </div>
  );
}
