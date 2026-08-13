"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { markPlanPublishedAction } from "@/server/actions/planned-post-actions";
import { TerminalPane, type TerminalHandle } from "@/components/studio/terminal-pane";

interface CapturedRender { assetId: string; url: string }

/**
 * The studio's live pane pair (content machine v1, task 5): a real terminal in the center
 * and the render/publish controls on the right. This is the component the studio screen's
 * placeholder panes wire into — it owns the terminal ref, the captured render, and the
 * cook/publish/save transitions so studio-screen.tsx stays a plain server-rendered shell
 * around the Brief pane.
 */
export function StudioPanel({ postId, hasFramePass }: { postId: string; hasFramePass: boolean }) {
  const termRef = useRef<TerminalHandle>(null);
  const [render, setRender] = useState<CapturedRender | null>(null);
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inject = (cmd: string) => termRef.current?.send(`${cmd}\r`);
  const cook = () => { setStarted(true); inject("/ksa:cooking"); };
  const publish = () => inject("/ksa:serve");
  const saveToCalendar = () => {
    setSaveError(null);
    startTransition(async () => {
      const res = await markPlanPublishedAction(postId, null);
      if (res.ok) setSaved(true);
      else setSaveError(res.error);
    });
  };

  return (
    <>
      {/* Center: live terminal + command controls */}
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Claude Code</span>
          <div className="ml-auto flex items-center gap-2">
            {!hasFramePass && (
              <span className="font-mono text-2xs text-muted-foreground">frame pass not run</span>
            )}
            <Button type="button" variant="secondary" onClick={cook}>
              {started ? "Retry cook" : "Cook"}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <TerminalPane ref={termRef} postId={postId} onRender={setRender} />
        </div>
      </div>

      {/* Right: output */}
      <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto p-6">
        <span className="font-mono text-2xs tracking-wide text-faint uppercase">Output</span>
        {render ? (
          <video src={render.url} controls className="aspect-[9/16] w-full border border-border bg-black" />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center border border-border bg-card px-4 text-center text-xs text-muted-foreground">
            {started ? "Cooking. The render appears here when it finishes." : "Run Cook to start the session."}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" disabled={!render} onClick={publish} className="w-full">
            Publish
          </Button>
          <p className="text-xs text-muted-foreground">
            Publish runs /ksa:serve in the session (official Graph API). It unlocks once a render exists.
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
