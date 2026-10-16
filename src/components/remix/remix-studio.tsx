"use client";

import { useCallback, useEffect, useState } from "react";

import { autosave } from "@/components/remix/autosave";
import { ContextRail } from "@/components/remix/context-rail";
import { resolveDeepLinkSeed } from "@/components/remix/deep-link";
import { StageHook } from "@/components/remix/stage-hook";
import { StagePrompt } from "@/components/remix/stage-prompt";
import { StageResearch } from "@/components/remix/stage-research";
import { StageFinish } from "@/components/remix/stage-finish";
import { StageScript } from "@/components/remix/stage-script";
import { StageStyle } from "@/components/remix/stage-style";
import { STAGE_ORDER, Stepper } from "@/components/remix/stepper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { CardFooter } from "@/components/ui/card";
import { updateStageAction } from "@/server/actions/remix-actions";
import type { SavedPostRow } from "@/server/queries/saved-posts";
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
  vaultHooks,
  vaultStyles,
  vaultSavedPosts,
  niche,
  seedHookVaultItemId,
  seedStyleVaultItemId,
}: {
  detail: VideoDetail;
  initialSession: RemixSessionRow;
  vaultHooks: VaultItemRow[];
  vaultStyles: VaultItemRow[];
  // The Vault's own saved posts (queries/saved-posts.ts), most recent first — what
  // the Research stage reads instead of ignoring the Vault (v1-scope.md, Remix
  // studio P0: "the point of saving a post is that it seeds the next remix").
  vaultSavedPosts: SavedPostRow[];
  niche: string;
  // A Vault template card's "Use in Remix" deep link (?hook=<id> / ?style=<id>).
  seedHookVaultItemId?: string;
  seedStyleVaultItemId?: string;
}) {
  // Computed once from the initial props — see deep-link.ts. Mirrors the
  // `useState(() => ...)` "compute once from props, no setter used" idiom already in
  // stage-prompt.tsx's `defaultTopic`.
  const [deepLinkSeed] = useState(() =>
    resolveDeepLinkSeed({ session: initialSession, seedHookVaultItemId, seedStyleVaultItemId, vaultHooks, vaultStyles })
  );
  const [session, setSession] = useState<RemixSessionRow>(() => ({ ...initialSession, ...deepLinkSeed.sessionPatch }));
  const [activeStage, setActiveStage] = useState<RemixStage>(deepLinkSeed.activeStage);
  // Persists the deep-link seed once on mount — local `session`/`activeStage` state
  // above already reflects it immediately, this just makes sure it survives past this
  // render (a refresh, or the stepper's furthest-stage gate which reads
  // `session.stage`). No setState call in this body (only the network call), so
  // there's nothing for react-hooks/set-state-in-effect to flag.
  useEffect(() => {
    if (deepLinkSeed.sessionPatch) {
      autosave(updateStageAction(initialSession.id, deepLinkSeed.sessionPatch));
    }
  }, [initialSession.id, deepLinkSeed.sessionPatch]);

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
    (activeStage === "style" && Boolean(session.outline)) ||
    // The Script stage advances once a variant exists. Not once one is
    // PICKED: the Finish view is where the pick is confirmed, and gating entry to it on
    // the pick would hide the screen that explains what is missing.
    (activeStage === "script" && (session.variants?.length ?? 0) > 0);

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

  // Clears the furthest-reached stage back to "prompt" (acceptance criterion 6) —
  // deliberately only the stage: topic/hookOptions/outline/variants are left as they
  // are (updateStage has no "clear this field" path to reach for without a schema
  // change), so a restarted run still reuses what the agent already wrote.
  async function handleRestart() {
    setActiveStage("prompt");
    if (session.stage !== "prompt") {
      patchSession({ stage: "prompt" });
      await updateStageAction(session.id, { stage: "prompt" });
    }
  }

  return (
    // Below lg the rail stacks above the stage and the whole studio is one scroller;
    // at lg the rail and the stage scroll independently inside a fixed viewport.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <ContextRail detail={detail} />

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <Stepper activeStage={activeStage} furthestStage={session.stage} onSelect={goToStage} />
        </div>

        {/* 2026-08-15 spec part 7: one line naming what this whole studio is doing,
            so the stepper's six labels read as a sequence rather than six unrelated
            screens. */}
        <div className="px-4 pt-4 sm:px-6">
          <Alert>
            <AlertDescription>Turning this post into your script.</AlertDescription>
          </Alert>
        </div>

        <div className="flex-1 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
          <div
            key={activeStage}
            className="animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
          >
            {activeStage === "prompt" && (
              <StagePrompt
                session={session}
                sourceTopic={detail.item.caption ?? "this topic"}
                niche={niche}
                onUpdate={patchSession}
              />
            )}
            {activeStage === "research" && (
              <StageResearch session={session} vaultSavedPosts={vaultSavedPosts} onNotesChange={(researchNotes) => patchSession({ researchNotes })} />
            )}
            {activeStage === "hook" && (
              <StageHook
                session={session}
                vaultHooks={vaultHooks}
                initialVaultItemId={deepLinkSeed.hookVaultItemId}
                onChosenHookChange={(chosenHook) => patchSession({ chosenHook })}
              />
            )}
            {activeStage === "style" && (
              <StageStyle
                session={session}
                vaultStyles={vaultStyles}
                onOutlineChange={(outline) => patchSession({ outline })}
                onStyleVaultItemChange={(styleVaultItemId) => patchSession({ styleVaultItemId })}
              />
            )}
            {activeStage === "script" && (
              <StageScript
                session={session}
                onVariantsChange={(variants) => patchSession({ variants })}
                onChosenVariantChange={(chosenVariantIndex) => patchSession({ chosenVariantIndex })}
              />
            )}
            {activeStage === "finish" && <StageFinish session={session} />}
          </div>

        </div>

        <CardFooter className="flex-wrap justify-between gap-2 border-t border-border pb-4 [--card-spacing:--spacing(4)] sm:pb-6 sm:[--card-spacing:--spacing(6)]">
          <Button variant="outline" onClick={handleBack} disabled={activeIndex === 0}>
            ← Back
          </Button>
          <ButtonGroup>
            <Button variant="ghost" onClick={handleRestart} disabled={session.stage === "prompt"}>
              Restart
            </Button>
            {activeStage !== "finish" && (
              <Button onClick={handleContinue} disabled={!canContinue}>
                Continue →
              </Button>
            )}
          </ButtonGroup>
        </CardFooter>
      </div>
    </div>
  );
}
