"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFramePassJobAction, runFramePassAction } from "@/server/actions/analyze-actions";
import { downloadVideoAction } from "@/server/actions/media-actions";
import type { StoredVideoAnalysis } from "@/server/services/analyze";
import { BEAT_LAYOUT_FIELDS, asBeatLayout, type VideoLayoutField } from "@/server/llm/schemas";
import { formatDuration } from "@/lib/format";

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

/** Column headers for the per-beat table, in `BEAT_LAYOUT_FIELDS` order. */
const FIELD_LABELS: Record<(typeof BEAT_LAYOUT_FIELDS)[number], string> = {
  onScreenText: "On-screen text",
  animation: "Animation",
  demoCursor: "Demo cursor",
  toolDemo: "Tool demo",
  textPosition: "Text position",
  voicePace: "Voice pace",
};

/**
 * The Layout section (V1 scope §2, Video detail criterion 9; V1 data contracts
 * contract 5): what a video looks like as opposed to what it says. Read only from a frame
 * pass, never guessed from the transcript.
 *
 * One row per story beat, keyed to the beat's timecodes, with six readings per row. The
 * flat whole-video reading this replaced averaged a hard-cut close-up hook and a slow
 * screen-recording payoff into one description that fit neither.
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

  const stored = analysis?.layout ?? null;
  // Null here means either no pass has run or the stored row is the old flat shape.
  // A flat reading carries no beat timecodes, so it cannot be shown in a per-beat table
  // and nothing translates one into beat rows; those videos get the re-run prompt.
  const beats = asBeatLayout(stored);
  const isLegacyFlat = stored !== null && beats === null;
  const everRun = analysis?.framePassAt !== null && analysis?.framePassAt !== undefined;
  const failed = everRun && stored === null && !!analysis?.framePassError;

  return (
    // A Card with no top margin: this is the whole of its own tab now, not a section
    // trailing the beats inside Hook & structure, so extra space under the tab row
    // would just be dead.
    <Card>
      <CardHeader>
        <CardTitle>Layout</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {beats !== null && (
          // Scrolls inside Table's own container: six reading columns plus the beat key
          // is wider than the detail pane, and the page body must not scroll sideways.
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead>Beat</TableHead>
                {BEAT_LAYOUT_FIELDS.map((key) => (
                  <TableHead key={key}>{FIELD_LABELS[key]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {beats.map((beat, i) => (
                <TableRow key={i} className="align-top">
                  <TableCell>
                    <div className="font-semibold text-foreground">{beat.label}</div>
                    <div data-num className="font-mono text-2xs text-muted-foreground">
                      {formatDuration(beat.startSec)}–{formatDuration(beat.endSec)}
                    </div>
                  </TableCell>
                  {BEAT_LAYOUT_FIELDS.map((key) => {
                    const value = fieldValue(beat[key]);
                    return (
                      // whitespace-normal, not TableCell's default nowrap: a reading is a
                      // sentence, and six of them on one line would push the row far past
                      // the min-width the columns are already scrolled to fit.
                      <TableCell
                        key={key}
                        className={value !== null ? "whitespace-normal" : "whitespace-normal text-muted-foreground"}
                      >
                        {value ?? "—"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="max-w-[56ch] text-sm text-muted-foreground">
          {beats !== null ? (
            <>
              Read from <span data-num>{analysis?.framesSampled ?? "—"}</span> sampled frames
              {analysis?.frameModel ? ` via ${analysis.frameModel}` : ""}, one row per story beat.
            </>
          ) : isLegacyFlat ? (
            <>
              This video&rsquo;s layout was read before the reading went per beat, so it is one
              flat description with no beat timecodes to hang it on. Re-run the frame pass to
              get the per-beat table. Nothing is translated across; the old reading is not
              reshaped into beats it never described.
            </>
          ) : lastCode === "FRAME_NO_BEATS" ? (
            <>
              The layout is read per story beat, and this video has no beats yet. Analyze it
              on the Hook &amp; structure tab first, then run the frame pass.
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
              No frame pass has run for this video yet. Running one samples frames and reads,
              for each story beat, its on-screen text, animation, demo cursor, tool demo, text
              position, and voice pace. Nothing above is a guess standing in for a reading.
            </>
          )}
        </p>
      </CardContent>

      <CardFooter>
        {(() => {
          const cta = framePassCta({ hasLayout: beats !== null, lastCode });
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={cta.kind === "download" ? downloadThenHint : runFramePass}
              disabled={pending}
            >
              {pending ? "Running…" : cta.label}
            </Button>
          );
        })()}
      </CardFooter>
    </Card>
  );
}
