"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markPlanPublishedAction } from "@/server/actions/planned-post-actions";
import { getPublishStateAction, stopCreateRunAction } from "@/server/actions/create-run-actions";
import { TerminalPane, type TerminalHandle } from "@/components/studio/terminal-pane";

interface CapturedRender { assetId: string; url: string }
interface RunState { runId: string; status: string }

/** Pill copy + color per create-run status, matching the approved preview
 *  (docs/design/mockups/create-run-tracking-preview.html): amber stays reserved for the
 *  running-state dot (the design system's amber budget), success/failed/canceled reuse
 *  the same --pos/--destructive/--muted-foreground tones the /runs list already uses for
 *  its own status dots (STATUS_DOT in runs-list.tsx). The design brief called for a blue
 *  "waiting" tone, but no blue token exists anywhere in globals.css or the shipped /runs
 *  list — runs-list.tsx's own STATUS_DOT map treats "waiting" as a foreground pulse, same
 *  as "running", so this follows that precedent instead of inventing a new color.
 */
const RUN_PILL: Record<string, { label: string; text: string; dot: string }> = {
  running: { label: "cooking", text: "text-score", dot: "bg-score animate-pulse" },
  waiting: { label: "waiting on you", text: "text-foreground", dot: "bg-foreground animate-pulse" },
  success: { label: "done", text: "text-pos", dot: "bg-pos" },
  failed: { label: "failed", text: "text-destructive", dot: "bg-destructive" },
  canceled: { label: "canceled", text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The studio's live pane pair (content machine v1, task 5): a real terminal in the center
 * and the render/publish controls on the right. This is the component the studio screen's
 * placeholder panes wire into — it owns the terminal ref, the captured render, and the
 * cook/publish/save transitions so studio-screen.tsx stays a plain server-rendered shell
 * around the Brief pane.
 *
 * D1 create-run tracking (task 4) adds the status strip: ws.ts starts a create_run
 * server-side as soon as the cook's pty spawns and pushes its id/status back over the
 * same socket as `{type:"run",...}` frames (see terminal-pane.tsx's onRun). This
 * component only renders what it is told; it never starts a run on its own.
 */
export function StudioPanel({ postId, hasFramePass }: { postId: string; hasFramePass: boolean }) {
  const termRef = useRef<TerminalHandle>(null);
  const [render, setRender] = useState<CapturedRender | null>(null);
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [run, setRun] = useState<RunState | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [stopPending, startStopTransition] = useTransition();

  // Persisted render, gating Publish (D1 task 7 / B2): loaded once on mount so Publish
  // stays enabled across a reload even though `render` (the live capture) resets to null.
  // Independent of `render` — either one being set is enough to unlock the button.
  const [persistedRenderAssetId, setPersistedRenderAssetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPublishStateAction(postId).then((res) => {
      if (cancelled || !res.ok) return;
      if (res.publish) setPersistedRenderAssetId(res.publish.renderAssetId);
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const handleRun = (message: RunState) => {
    setRun((prev) => {
      // A fresh runId is always a fresh spawn (task 4 assumes one run per ws attach,
      // never a reattach to an in-progress run — that's task 5/6's job), so this is
      // where the elapsed clock's zero point gets recorded.
      if (!prev || prev.runId !== message.runId) {
        setRunStartedAt(Date.now());
      }
      return message;
    });
  };

  useEffect(() => {
    if (runStartedAt === null) return;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)));
    tick();
    if (run && (run.status === "running" || run.status === "waiting")) {
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
  }, [runStartedAt, run]);

  const inject = (cmd: string) => termRef.current?.send(`${cmd}\r`);
  const cook = () => { setStarted(true); inject("/ksa:cooking"); };
  const canPublish = render !== null || persistedRenderAssetId !== null;
  const publish = () => {
    if (!canPublish) return;
    if (!window.confirm("Publish this render to Instagram?")) return;
    inject("/ksa:serve");
  };
  const stop = () => {
    if (!run) return;
    const runId = run.runId;
    startStopTransition(async () => {
      const res = await stopCreateRunAction(runId);
      if (res.ok) {
        setRun((prev) => (prev && prev.runId === runId ? { ...prev, status: "canceled" } : prev));
      }
    });
  };
  const saveToCalendar = () => {
    setSaveError(null);
    startTransition(async () => {
      const res = await markPlanPublishedAction(postId, null);
      if (res.ok) setSaved(true);
      else setSaveError(res.error);
    });
  };

  const isLive = run !== null && (run.status === "running" || run.status === "waiting");
  const pill = run ? (RUN_PILL[run.status] ?? RUN_PILL.canceled) : null;

  return (
    <>
      {/* Center: live terminal + command controls */}
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Claude Code</span>
          <div className="ml-auto flex items-center gap-3">
            {!hasFramePass && (
              <span className="font-mono text-2xs text-muted-foreground">frame pass not run</span>
            )}
            {run && pill && (
              <>
                <span
                  data-testid="studio-run-pill"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-2xs font-medium",
                    pill.text,
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", pill.dot)} />
                  {pill.label}
                </span>
                <span className="font-mono text-2xs tabular-nums text-faint">{formatElapsed(elapsedSec)}</span>
                <a
                  href={`/runs/${run.runId}`}
                  className="font-mono text-2xs text-muted-foreground underline decoration-1 underline-offset-2 hover:text-foreground"
                >
                  view run &rsaquo;
                </a>
              </>
            )}
            {isLive ? (
              <Button type="button" variant="destructive" size="sm" disabled={stopPending} onClick={stop}>
                {stopPending ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" data-testid="studio-cook-button" onClick={cook}>
                {run || started ? "Retry cook" : "Cook"}
              </Button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <TerminalPane ref={termRef} postId={postId} onRender={setRender} onRun={handleRun} />
        </div>
      </div>

      {/* Right: output */}
      <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto p-6">
        <span className="font-mono text-2xs tracking-wide text-faint uppercase">Output</span>
        {render ? (
          <video
            src={render.url}
            controls
            data-testid="studio-render-video"
            className="aspect-[9/16] w-full border border-border bg-black"
          />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center border border-border bg-card px-4 text-center text-xs text-muted-foreground">
            {started ? "Cooking. The render appears here when it finishes." : "Run Cook to start the session."}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!canPublish}
            data-testid="studio-publish-button"
            onClick={publish}
            className="w-full"
          >
            Publish
          </Button>
          <p className="text-xs text-muted-foreground">
            Publish runs /ksa:serve in the session (official Graph API). It unlocks once a render exists, and
            stays unlocked after a reload as long as that render is saved.
          </p>
          <Button type="button" variant="outline" disabled={!render || pending || saved} onClick={saveToCalendar} className="w-full">
            {saved ? "Saved to calendar" : "Save to calendar"}
          </Button>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
      </div>
    </>
  );
}
