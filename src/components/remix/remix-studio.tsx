"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { ContextRail } from "@/components/remix/context-rail";
import { StageHook } from "@/components/remix/stage-hook";
import { StagePrompt } from "@/components/remix/stage-prompt";
import { StageResearch } from "@/components/remix/stage-research";
import { StageScript } from "@/components/remix/stage-script";
import { StageStyle } from "@/components/remix/stage-style";
import { STAGE_ORDER, Stepper } from "@/components/remix/stepper";
import { Button } from "@/components/ui/button";
import { getOrCreateSessionAction, quickRemixAction, updateStageAction } from "@/server/actions/remix-actions";
import type { VaultItemRow } from "@/server/queries/vault";
import type { VideoDetail } from "@/server/queries/video";
import type { RemixSessionRow, RemixStage } from "@/server/services/remix";

/**
 * Owns the interactive session state for the whole studio (Task 6): which stage is
 * being viewed vs. the furthest one reached (persisted as `remix_sessions.stage`),
 * and the session row itself, kept in sync locally so stage components don't need a
 * full page round-trip after every edit. Stage components call server actions
 * directly and report results back up via the callbacks below.
 */
export function RemixStudio({
  detail,
  initialSession,
  hasLlmKey,
  vaultHooks,
  vaultStyles,
  niche,
}: {
  detail: VideoDetail;
  initialSession: RemixSessionRow;
  hasLlmKey: boolean;
  vaultHooks: VaultItemRow[];
  vaultStyles: VaultItemRow[];
  niche: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [activeStage, setActiveStage] = useState<RemixStage>(initialSession.stage);
  const [quickRemixPending, setQuickRemixPending] = useState(false);

  const patchSession = useCallback((patch: Partial<RemixSessionRow>) => {
    setSession((prev) => ({ ...prev, ...patch }));
  }, []);

  const furthestIndex = STAGE_ORDER.indexOf(session.stage);
  const activeIndex = STAGE_ORDER.indexOf(activeStage);

  function goToStage(stage: RemixStage) {
    if (STAGE_ORDER.indexOf(stage) <= furthestIndex) setActiveStage(stage);
  }

  const canContinue =
    (activeStage === "prompt" && Boolean(session.topic)) ||
    (activeStage === "research" && true) ||
    (activeStage === "hook" && Boolean(session.chosenHook)) ||
    (activeStage === "style" && Boolean(session.outline));

  async function handleContinue() {
    const nextStage = STAGE_ORDER[activeIndex + 1];
    if (!nextStage) return;
    setActiveStage(nextStage);
    if (STAGE_ORDER.indexOf(nextStage) > furthestIndex) {
      patchSession({ stage: nextStage });
      await updateStageAction(session.id, { stage: nextStage });
    }
  }

  function handleBack() {
    const prevStage = STAGE_ORDER[activeIndex - 1];
    if (prevStage) setActiveStage(prevStage);
  }

  async function handleQuickRemix() {
    setQuickRemixPending(true);
    const result = await quickRemixAction(session.id);
    if (!result.ok) {
      setQuickRemixPending(false);
      toast.error(result.error);
      return;
    }
    const refreshed = await getOrCreateSessionAction(detail.item.videoId);
    setQuickRemixPending(false);
    if (refreshed.ok) {
      setSession(refreshed.session);
      setActiveStage(refreshed.session.stage);
    }
  }

  return (
    <div className="flex h-full">
      <ContextRail detail={detail} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <Stepper activeStage={activeStage} furthestStage={session.stage} onSelect={goToStage} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {activeStage === "prompt" && (
            <StagePrompt
              session={session}
              sourceTopic={detail.item.caption ?? "this topic"}
              niche={niche}
              hasLlmKey={hasLlmKey}
              quickRemixPending={quickRemixPending}
              onUpdate={patchSession}
              onQuickRemix={handleQuickRemix}
            />
          )}
          {activeStage === "research" && <StageResearch session={session} onNotesChange={(researchNotes) => patchSession({ researchNotes })} />}
          {activeStage === "hook" && (
            <StageHook
              session={session}
              vaultHooks={vaultHooks}
              hasLlmKey={hasLlmKey}
              onHooksChange={(hookOptions) => patchSession({ hookOptions })}
              onChosenHookChange={(chosenHook) => patchSession({ chosenHook })}
            />
          )}
          {activeStage === "style" && (
            <StageStyle
              session={session}
              vaultStyles={vaultStyles}
              hasLlmKey={hasLlmKey}
              onOutlineChange={(outline) => patchSession({ outline })}
              onStyleVaultItemChange={(styleVaultItemId) => patchSession({ styleVaultItemId })}
            />
          )}
          {activeStage === "script" && (
            <StageScript session={session} hasLlmKey={hasLlmKey} onVariantsChange={(variants) => patchSession({ variants })} />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" onClick={handleBack} disabled={activeIndex === 0}>
            ← Back
          </Button>
          {activeStage !== "script" && (
            <Button onClick={handleContinue} disabled={!canContinue}>
              Continue →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
