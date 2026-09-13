"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { autosave } from "@/components/remix/autosave";
import { ContextRail } from "@/components/remix/context-rail";
import { resolveDeepLinkSeed } from "@/components/remix/deep-link";
import { RunLog } from "@/components/remix/run-log";
import { isProxyLikelyDown } from "@/components/remix/run-log-view";
import { StageHook } from "@/components/remix/stage-hook";
import { StagePrompt } from "@/components/remix/stage-prompt";
import { StageResearch } from "@/components/remix/stage-research";
import { StageFinish } from "@/components/remix/stage-finish";
import { StageScript } from "@/components/remix/stage-script";
import { StageStyle } from "@/components/remix/stage-style";
import { STAGE_ORDER, Stepper } from "@/components/remix/stepper";
import { Button } from "@/components/ui/button";
import {
  getOrCreateSessionAction,
  getRemixRunLogAction,
  quickRemixAction,
  updateStageAction,
} from "@/server/actions/remix-actions";
import type { RemixRunRow } from "@/server/queries/remix-runs";
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
  hasLlmKey,
  vaultHooks,
  vaultStyles,
  vaultSavedPosts,
  niche,
  llmProxyUrl,
  seedHookVaultItemId,
  seedStyleVaultItemId,
}: {
  detail: VideoDetail;
  initialSession: RemixSessionRow;
  hasLlmKey: boolean;
  vaultHooks: VaultItemRow[];
  vaultStyles: VaultItemRow[];
  // The Vault's own saved posts (queries/saved-posts.ts), most recent first — what
  // the Research stage reads instead of ignoring the Vault (v1-scope.md, Remix
  // studio P0: "the point of saving a post is that it seeds the next remix").
  vaultSavedPosts: SavedPostRow[];
  niche: string;
  // `LLM_BASE_URL` when set (the local 9router proxy) — read once, server-side,
  // in page.tsx, purely so the blocked surface can name where it looked rather than
  // saying "somewhere" (v1-scope.md: "a recovery action that names the command to
  // start the proxy" — the address is the honest half of that this app can supply;
  // there is no in-repo command that starts an external process).
  llmProxyUrl: string | null;
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
  const [quickRemixPending, setQuickRemixPending] = useState(false);
  // null = not fetched yet (kept distinct from "fetched, zero rows" — see run-log.tsx).
  const [runs, setRuns] = useState<RemixRunRow[] | null>(null);

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

  // The run log's own source of truth (v1-scope.md, Remix studio P0 #5): fetched on
  // mount so it survives a reload, and re-fetched by each generation stage after its
  // own attempt (success or failure — `generateHooks`/`generateOutline`/
  // `generateVariants` all write a row on both) via the `onRunRecorded` callback
  // passed down below, so the panel and the proxy-down read stay live without the
  // user reloading the page. `refreshRunLog` is what stage callbacks call (an event
  // handler, not an effect body, so calling it directly is fine there); the mount
  // fetch below inlines the same call instead of invoking that function, matching
  // stage-research.tsx's own cancelled-guarded effect shape rather than tripping
  // react-hooks/set-state-in-effect on a function reference.
  const refreshRunLog = useCallback(async () => {
    const result = await getRemixRunLogAction(session.id);
    if (result.ok) setRuns(result.runs);
  }, [session.id]);

  useEffect(() => {
    let cancelled = false;
    getRemixRunLogAction(session.id).then((result) => {
      if (!cancelled && result.ok) setRuns(result.runs);
    });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  // Grounded in the run log itself, not a separate ping (Wave 2 rendering-layer-only
  // rule — no new server action to actually reach the proxy): see
  // `run-log-view.ts`'s `isProxyLikelyDown` for what counts as evidence. `runs ===
  // null` (not yet fetched) reads as "unknown", never as "down".
  const proxyDown = runs !== null && isProxyLikelyDown(runs);

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
    // The Script stage advances once a variant exists. Not once one is PICKED: the
    // Finish view is where the pick is confirmed, and gating entry to it on the pick
    // would hide the screen that explains what is missing.
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
  // change), so a restarted run still gets to reuse what generation already produced
  // instead of throwing it away. The run log is its own table, untouched by this.
  async function handleRestart() {
    setActiveStage("prompt");
    if (session.stage !== "prompt") {
      patchSession({ stage: "prompt" });
      await updateStageAction(session.id, { stage: "prompt" });
    }
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
    refreshRunLog(); // quickRemix runs hooks/outline/variants server-side in one call
  }

  return (
    <div className="flex h-full">
      <ContextRail detail={detail} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <Stepper activeStage={activeStage} furthestStage={session.stage} onSelect={goToStage} />
        </div>

        {/* 2026-08-15 spec part 7: one line naming what this whole studio is doing,
            so the stepper's six labels read as a sequence rather than six unrelated
            screens. */}
        <div className="border-b border-border bg-muted/30 px-6 py-2 text-sm text-muted-foreground">
          Turning this post into your script.
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            key={activeStage}
            className="animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
          >
            {activeStage === "prompt" && (
              <StagePrompt
                session={session}
                sourceTopic={detail.item.caption ?? "this topic"}
                niche={niche}
                hasLlmKey={hasLlmKey}
                proxyDown={proxyDown}
                quickRemixPending={quickRemixPending}
                onUpdate={patchSession}
                onQuickRemix={handleQuickRemix}
              />
            )}
            {activeStage === "research" && (
              <StageResearch session={session} vaultSavedPosts={vaultSavedPosts} onNotesChange={(researchNotes) => patchSession({ researchNotes })} />
            )}
            {activeStage === "hook" && (
              <StageHook
                session={session}
                vaultHooks={vaultHooks}
                hasLlmKey={hasLlmKey}
                proxyDown={proxyDown}
                llmProxyUrl={llmProxyUrl}
                initialVaultItemId={deepLinkSeed.hookVaultItemId}
                onHooksChange={(hookOptions) => patchSession({ hookOptions })}
                onChosenHookChange={(chosenHook) => patchSession({ chosenHook })}
                onRunRecorded={refreshRunLog}
              />
            )}
            {activeStage === "style" && (
              <StageStyle
                session={session}
                vaultStyles={vaultStyles}
                hasLlmKey={hasLlmKey}
                proxyDown={proxyDown}
                llmProxyUrl={llmProxyUrl}
                onOutlineChange={(outline, regenerated) =>
                  patchSession(regenerated ? { outline, variants: null, chosenVariantIndex: null } : { outline })
                }
                onStyleVaultItemChange={(styleVaultItemId) => patchSession({ styleVaultItemId })}
                onRunRecorded={refreshRunLog}
              />
            )}
            {activeStage === "script" && (
              <StageScript
                session={session}
                hasLlmKey={hasLlmKey}
                proxyDown={proxyDown}
                llmProxyUrl={llmProxyUrl}
                onVariantsChange={(variants) => patchSession({ variants })}
                onChosenVariantChange={(chosenVariantIndex) => patchSession({ chosenVariantIndex })}
                onRunRecorded={refreshRunLog}
              />
            )}
            {activeStage === "finish" && <StageFinish session={session} />}
          </div>

          {activeStage !== "prompt" && <RunLog runs={runs} />}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" onClick={handleBack} disabled={activeIndex === 0}>
            ← Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleRestart} disabled={session.stage === "prompt"}>
              Restart
            </Button>
            {activeStage !== "finish" && (
              <Button onClick={handleContinue} disabled={!canContinue}>
                Continue →
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
