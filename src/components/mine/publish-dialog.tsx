"use client";

/**
 * Upload an mp4, write a caption, pick a time, and either schedule the publish or fire it
 * now (implementation plan Phase D, task D2). DESIGN.md is binding here:
 *
 * - Exactly ONE primary action per state — "Schedule" when a date and time are set,
 *   "Publish now" when they are not. Every other control (pick file, cancel) is neutral,
 *   so the screen only ever offers one thing to press.
 * - Every number — the caption count, the date, the time — is IBM Plex Mono, tabular.
 * - When the Graph token or the storage bucket is missing, this does NOT fake a publish:
 *   it names exactly what to set (mirroring GraphConnectPanel) and disables the action,
 *   while the upload and caption still save so the plan keeps its draft.
 * - Dry-run shows a banner saying the final publish POST is skipped, so a dev box
 *   can rehearse the whole path without touching the live account.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import {
  publishNowAction,
  schedulePublishAction,
  setPlanCaptionAction,
  uploadPlanVideoAction,
} from "@/server/actions/planned-post-actions";
import type { PlannedPostRow } from "@/server/queries/planned-posts";

const CAPTION_MAX = 2200;

export function PublishDialog({
  open,
  onOpenChange,
  plan,
  graphConfigured,
  bucketConfigured,
  dryRun,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlannedPostRow;
  graphConfigured: boolean;
  bucketConfigured: boolean;
  dryRun: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  // A publish can only be scheduled forward, so never pre-fill or allow a past date: an
  // old plan carrying a stale plannedDate would otherwise nudge the user straight into a
  // schedule the action rejects.
  const today = new Date().toISOString().slice(0, 10);

  const [hasVideo, setHasVideo] = useState(plan.videoAssetId !== null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [caption, setCaption] = useState(plan.caption ?? "");
  const [date, setDate] = useState(plan.plannedDate && plan.plannedDate >= today ? plan.plannedDate : "");
  const [time, setTime] = useState(plan.plannedTime ?? "");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = graphConfigured && bucketConfigured;
  const dated = date !== "" && time !== "";
  const canSubmit = hasVideo && caption.trim().length > 0 && configured && !submitting && !uploading;

  async function upload(file: File) {
    setError(null);
    if (!(file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4"))) {
      setError("Only an .mp4 video can be published.");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadPlanVideoAction(plan.id, fd);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHasVideo(true);
    setVideoName(file.name);
    toast.success("Video attached");
    router.refresh();
  }

  async function saveCaption() {
    const result = await setPlanCaptionAction(plan.id, caption);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    return true;
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    if (!(await saveCaption())) {
      setSubmitting(false);
      return;
    }
    const result = dated ? await schedulePublishAction(plan.id, `${date}T${time}`) : await publishNowAction(plan.id);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(dated ? "Scheduled" : dryRun ? "Dry-run publish complete" : "Published");
    onOpenChange(false);
    onDone();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle>Publish {plan.title}</DialogTitle>
          <DialogDescription>
            Upload the Reel, write its caption, and schedule it — or publish it now, straight to your own channel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!configured && (
            <Alert data-testid="publish-dialog-not-configured">
              <AlertTitle>Publish setup</AlertTitle>
              <AlertDescription>
                {!graphConfigured && (
                  <p>
                    Connect Graph to publish: set <code className="font-mono text-2xs text-foreground">IG_GRAPH_TOKEN</code> and{" "}
                    <code className="font-mono text-2xs text-foreground">IG_GRAPH_USER_ID</code>.
                  </p>
                )}
                {!bucketConfigured && (
                  <p>
                    Set <code className="font-mono text-2xs text-foreground">S3_*</code> to publish
                    (<code className="font-mono text-2xs text-foreground">S3_ENDPOINT</code>,{" "}
                    <code className="font-mono text-2xs text-foreground">S3_BUCKET</code>,{" "}
                    <code className="font-mono text-2xs text-foreground">S3_KEY</code>,{" "}
                    <code className="font-mono text-2xs text-foreground">S3_SECRET</code>,{" "}
                    <code className="font-mono text-2xs text-foreground">S3_PUBLIC_BASE</code>).
                  </p>
                )}
                <p>Your video and caption still save; the plan stays a draft until this is set.</p>
              </AlertDescription>
            </Alert>
          )}

          {configured && dryRun && (
            <Alert data-testid="publish-dialog-dry-run">
              <AlertDescription>
                DRY RUN · the whole path runs but the final publish POST is skipped, so the live account is never touched.
              </AlertDescription>
            </Alert>
          )}

          {/* Drop-zone + a file-picker fallback. The dashed border and the drag handlers
              sit on the Empty itself so the whole region is the drop target, same as the
              hand-rolled block it replaces. */}
          <Empty
            data-testid="publish-dialog-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void upload(file);
            }}
            className={cn("gap-3 border border-dashed p-6", dragOver && "border-foreground")}
          >
            <EmptyHeader>
              <EmptyTitle>
                {uploading ? "Uploading…" : hasVideo ? (videoName ?? "Video attached") : "Drop an .mp4 here"}
              </EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="publish-dialog-pick"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {hasVideo ? "Replace video" : "Choose file"}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,.mp4"
                className="hidden"
                data-testid="publish-dialog-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </EmptyContent>
          </Empty>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="publish-caption">Caption</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id="publish-caption"
                  data-testid="publish-dialog-caption"
                  value={caption}
                  maxLength={CAPTION_MAX}
                  onChange={(e) => setCaption(e.target.value)}
                  onBlur={() => void saveCaption()}
                  placeholder="What this Reel says"
                />
                <InputGroupAddon align="block-end">
                  <InputGroupText data-num className="ml-auto font-mono tabular-nums">
                    {caption.length} / {CAPTION_MAX}
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <div className="flex gap-3">
              <Field className="flex-1">
                <FieldLabel htmlFor="publish-date">Date</FieldLabel>
                <Input
                  id="publish-date"
                  type="date"
                  min={today}
                  data-testid="publish-dialog-date"
                  className="font-mono tabular-nums"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field className="flex-1">
                <FieldLabel htmlFor="publish-time">Time</FieldLabel>
                <Input
                  id="publish-time"
                  type="time"
                  data-testid="publish-dialog-time"
                  className="font-mono tabular-nums"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
            </div>
            <FieldDescription>Leave the time blank to publish now instead of scheduling.</FieldDescription>

            {error && <FieldError data-testid="publish-dialog-error">{error}</FieldError>}
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="publish-dialog-cancel">
            Cancel
          </Button>
          {/* The one primary action for this screen — its label is the only thing that
              changes between the scheduled and the immediate state. */}
          <Button onClick={submit} disabled={!canSubmit} data-testid="publish-dialog-submit">
            {submitting ? "Working…" : dated ? "Schedule" : "Publish now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
