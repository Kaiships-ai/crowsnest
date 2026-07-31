"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { runFramePassAction } from "@/server/actions/analyze-actions";
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
 * `runFramePassAction` always returns `ok:false, code:"FRAME_NO_VISION_MODEL"` today —
 * `src/server/llm/client.ts` has no image-input path, there's no frame sampler, and no
 * vision-capable model is configured (wave 0's still-open spike). That's not a stub
 * standing in for a TODO, it's the honest current state of the system, so this section
 * is built to say exactly that rather than hide, or imply the four fields below are
 * about to fill themselves in.
 */
export function LayoutSection({ videoId, analysis }: { videoId: string; analysis: StoredVideoAnalysis | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function runFramePass() {
    setPending(true);
    const result = await runFramePassAction(videoId);
    setPending(false);
    if (result.ok) {
      toast.success("Frame pass complete");
      router.refresh();
    } else {
      // The message and code both come straight from the action — never rephrased into
      // something that sounds more temporary than it is.
      toast.error(result.error);
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
            No vision-capable model is configured yet, so on-screen text, its position, cut rhythm, and framing can&rsquo;t
            be read from frames. These four stay dashes until that&rsquo;s wired up. Nothing above is a guess standing in
            for a reading.
          </>
        )}
      </p>

      <Button variant="outline" size="sm" className="mt-5" onClick={runFramePass} disabled={pending}>
        {pending ? "Running…" : layout !== null ? "Re-run frame pass" : failed ? "Retry frame pass" : "Run frame pass"}
      </Button>
    </div>
  );
}
