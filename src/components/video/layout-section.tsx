"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getFramePassJobAction, runFramePassAction } from "@/server/actions/analyze-actions";
import type { StoredVideoAnalysis } from "@/server/services/analyze";
import type { VideoLayoutField } from "@/server/llm/schemas";

/** A field only counts as a reading when it's backed by at least one sampled frame
 *  (schema.ts's VideoLayoutField: `fromFramesSec.length === 0` means "not a reading").
 *  Applies even once a real pass exists, so a future partial result can't render a
 *  value the model didn't actually see frames for. Exported standalone (rather than a
 *  closure inside the component) so it's testable without a router context. */
export function fieldValue(field: VideoLayoutField | undefined): string | null {
  if (!field || field.value === null || field.fromFramesSec.length === 0) return null;
  return field.value;
}

/**
 * The Layout section (V1 scope §2, Video detail criterion 9; V1 data contracts
 * contract 5): what a video looks like — on-screen text, its position, cut rhythm,
 * framing — as opposed to what it says. Read only from a frame pass, never guessed
 * from the transcript.
 *
 * The pass runs out of process: watch.py samples frames, a Claude Code subprocess limited
 * to Read looks at them, and the result is written through the validator that rejects a
 * value citing no frames. It takes tens of seconds, so this polls the job rather than
 * awaiting the action.
 */
export function LayoutSection({ videoId, analysis }: { videoId: string; analysis: StoredVideoAnalysis | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Guards every setState/toast in the poll loop against firing after unmount (e.g. the
  // user navigates away mid-pass). Doesn't cancel the in-flight action call itself — that
  // would still resolve server-side — it just stops the loop from scheduling more polls
  // or touching state once we're gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function runFramePass() {
    setPending(true);
    const started = await runFramePassAction(videoId);
    if (!started.ok) {
      if (mountedRef.current) setPending(false);
      toast.error(started.error);
      return;
    }

    // One model turn per frame means a pass can run for a minute or more. Poll rather
    // than hold the action open, and give up after 5 minutes so the button cannot stick.
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!mountedRef.current) return;
      const job = await getFramePassJobAction(started.jobId);
      if (job.status === "running") continue;
      if (!mountedRef.current) return;
      setPending(false);
      if (job.status === "success") {
        toast.success("Frame pass complete");
      } else {
        toast.error(job.error ?? "The frame pass produced no reading.");
      }
      router.refresh();
      return;
    }
    if (mountedRef.current) {
      setPending(false);
      toast.error("Frame pass is taking unusually long. Reload to see where it landed.");
    }
  }

  const layout = analysis?.layout ?? null;
  const everRun = analysis?.framePassAt !== null && analysis?.framePassAt !== undefined;
  const failed = everRun && layout === null && !!analysis?.framePassError;

  const rows: { key: string; label: string; value: string | null }[] = [
    { key: "onScreenText", label: "On-screen text", value: fieldValue(layout?.onScreenText) },
    { key: "textPosition", label: "Text position", value: fieldValue(layout?.textPosition) },
    { key: "cutRhythm", label: "Cut rhythm", value: fieldValue(layout?.cutRhythm) },
    { key: "framing", label: "Framing", value: fieldValue(layout?.framing) },
  ];

  return (
    <div className="mt-16">
      <span data-lab className="font-mono text-2xs text-faint">
        Layout
      </span>

      <div className="mt-6 flex flex-col gap-5">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[172px_minmax(0,1fr)] items-baseline gap-6">
            <span data-lab className="font-mono text-2xs text-faint">
              {row.label}
            </span>
            <span className={row.value !== null ? "text-sm text-foreground" : "text-sm text-faint"}>
              {row.value ?? "—"}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-5 max-w-[56ch] text-sm text-muted-foreground">
        {layout !== null ? (
          <>
            Read from <span data-num>{analysis?.framesSampled ?? "—"}</span> sampled frames
            {analysis?.frameModel ? ` via ${analysis.frameModel}` : ""}.
          </>
        ) : failed ? (
          <>Last frame pass didn&rsquo;t produce a reading: {analysis?.framePassError}.</>
        ) : (
          <>
            No frame pass has run for this video yet. Running one samples frames and reads
            on-screen text, its position, cut rhythm, and framing from them. Nothing above
            is a guess standing in for a reading.
          </>
        )}
      </p>

      <Button variant="outline" size="sm" className="mt-5" onClick={runFramePass} disabled={pending}>
        {pending ? "Running…" : layout !== null ? "Re-run frame pass" : failed ? "Retry frame pass" : "Run frame pass"}
      </Button>
    </div>
  );
}
