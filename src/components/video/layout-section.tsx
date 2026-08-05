"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getFramePassJobAction, runFramePassAction } from "@/server/actions/analyze-actions";
import { downloadVideoAction } from "@/server/actions/media-actions";
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

/** Which action the Layout button offers. A missing-file failure is the one case where the
 *  fix is not another pass but downloading the video first, so it gets its own kind.
 *  Exported standalone for the same reason as `fieldValue`: testable without a router. */
export function framePassCta(state: { hasLayout: boolean; lastCode: string | null }): {
  label: string;
  kind: "run" | "download";
} {
  if (state.lastCode === "FRAME_NO_VIDEO_ASSET") return { label: "Download video", kind: "download" };
  if (state.hasLayout) return { label: "Re-run frame pass", kind: "run" };
  return { label: "Run frame pass", kind: "run" };
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
  // The failure code of the last pass started from this component. Session-only on
  // purpose: `analysis` stores the failure *message* but no code, so a reload drops back
  // to the generic copy rather than showing a recovery button we can't justify.
  const [lastCode, setLastCode] = useState<string | null>(null);
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
      if (mountedRef.current) {
        setPending(false);
        setLastCode(started.code);
      }
      toast.error(started.error);
      return;
    }
    if (mountedRef.current) setLastCode(null);

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

  // The recovery path for FRAME_NO_VIDEO_ASSET: the pass needs a file on disk, so fetch
  // one. Stops there rather than chaining into a pass, because the download is the slow
  // half and the user should get to decide whether to spend the second half now.
  async function downloadThenHint() {
    setPending(true);
    const res = await downloadVideoAction(videoId);
    if (!mountedRef.current) return;
    setPending(false);
    if (res.ok) {
      setLastCode(null);
      toast.success("Video downloaded. Run the frame pass now.");
      router.refresh();
    } else {
      toast.error(res.error);
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
    // No top margin: this is the whole of its own tab now, not a section trailing the
    // beats inside Hook & structure, so mt-16 would just be dead space under the tab row.
    <div>
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
        ) : lastCode === "FRAME_NO_VIDEO_ASSET" ? (
          // Checked before `failed` because `analysis` is the server render's copy: right
          // after this failure it still says no pass has run, and that copy would
          // contradict the Download button sitting under it.
          <>This video has not been downloaded yet. Download it, then run the frame pass.</>
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

      {(() => {
        const cta = framePassCta({ hasLayout: layout !== null, lastCode });
        return (
          <Button
            variant="outline"
            size="sm"
            className="mt-5"
            onClick={cta.kind === "download" ? downloadThenHint : runFramePass}
            disabled={pending}
          >
            {pending ? "Running…" : cta.label}
          </Button>
        );
      })()}
    </div>
  );
}
