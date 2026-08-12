"use client";

/**
 * Create or edit a planned post (v1-scope.md §4 decision 3: "A planned post is a
 * script with a date, not a note with a date"). The one rule this dialog exists to
 * enforce, that the schema itself cannot: a plan with no script and no remix session
 * requires ticking "I don't have a script yet" before it can be saved. That checkbox is
 * not stored anywhere — the plan's `scriptId` staying null already says "no script", and
 * the calendar/day-panel render that null state visibly differently from a plan that
 * carries one (PlanCell / day panel below). The checkbox exists only to stop a plan
 * title turning into a no-script plan by accident.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  attachScriptToPlanAction,
  createPlannedPostAction,
  detachScriptFromPlanAction,
  schedulePlannedPostAction,
  unschedulePlannedPostAction,
  updatePlannedPostAction,
} from "@/server/actions/planned-post-actions";
import type { PlannedPostRow } from "@/server/queries/planned-posts";
import { VIDEO_KINDS } from "@/server/services/video-kind";

export interface ScriptOption {
  id: string;
  title: string;
}

export function PlanDialog({
  open,
  onOpenChange,
  plan,
  presetDate,
  scripts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode, absent when creating a fresh plan. */
  plan?: PlannedPostRow;
  /** Prefills the date when creating from a specific calendar cell. */
  presetDate?: string;
  scripts: ScriptOption[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const isEdit = plan !== undefined;

  const [title, setTitle] = useState(plan?.title ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [date, setDate] = useState(plan?.plannedDate ?? presetDate ?? "");
  const [scriptId, setScriptId] = useState<string>(plan?.scriptId ?? "");
  const [videoKind, setVideoKind] = useState<string>(plan?.videoKind ?? "");
  const [noScriptAck, setNoScriptAck] = useState(isEdit && !plan?.scriptId && !plan?.remixSessionId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carriesRemix = isEdit && plan?.remixSessionId !== null;
  const needsAck = scriptId === "" && !carriesRemix;
  const canSave = title.trim().length > 0 && (!needsAck || noScriptAck);

  function reset() {
    setTitle("");
    setNote("");
    setDate("");
    setScriptId("");
    setVideoKind("");
    setNoScriptAck(false);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);

    if (!isEdit) {
      const result = await createPlannedPostAction({
        title: title.trim(),
        note: note.trim() || undefined,
        plannedDate: date || undefined,
        scriptId: scriptId || undefined,
        videoKind: videoKind || undefined,
      });
      setSaving(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(date ? "Planned" : "Saved as a draft");
      reset();
      onOpenChange(false);
      onSaved();
      router.refresh();
      return;
    }

    // Edit mode: apply whichever fields changed, in sequence. Each write is its own
    // action (there's no bulk-patch action for date + script + text at once), so a
    // partial failure here still leaves whatever succeeded in place rather than losing
    // the whole edit.
    const planRow = plan!;
    if (title.trim() !== planRow.title || note.trim() !== (planRow.note ?? "")) {
      const r = await updatePlannedPostAction(planRow.id, { title: title.trim(), note: note.trim() });
      if (!r.ok) {
        setSaving(false);
        setError(r.error);
        return;
      }
    }
    if (date !== (planRow.plannedDate ?? "")) {
      const r = date ? await schedulePlannedPostAction(planRow.id, date) : await unschedulePlannedPostAction(planRow.id);
      if (!r.ok) {
        setSaving(false);
        setError(r.error);
        return;
      }
    }
    if (scriptId !== (planRow.scriptId ?? "")) {
      const r = scriptId ? await attachScriptToPlanAction(planRow.id, scriptId) : await detachScriptFromPlanAction(planRow.id);
      if (!r.ok) {
        setSaving(false);
        setError(r.error);
        return;
      }
    }
    if (videoKind !== (planRow.videoKind ?? "")) {
      const r = await updatePlannedPostAction(planRow.id, { videoKind: videoKind || null });
      if (!r.ok) {
        setSaving(false);
        setError(r.error);
        return;
      }
    }
    setSaving(false);
    toast.success("Plan updated");
    onOpenChange(false);
    onSaved();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit planned post" : "New planned post"}</DialogTitle>
          <DialogDescription>
            Nothing here publishes or reminds. This is a dated intention, nothing more, until you mark it
            published by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-title">Title</Label>
            <Input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this post is" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-date">Date</Label>
            <Input id="plan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave blank to keep it as an undated draft.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-note">Note</Label>
            <Textarea id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>

          {carriesRemix ? (
            <p className="text-xs text-muted-foreground">
              This plan carries a script from a remix run. Detaching it here isn&apos;t offered. Do that from
              the Vault.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-script">Script</Label>
              <Select value={scriptId || "none"} onValueChange={(v) => setScriptId(!v || v === "none" ? "" : v)}>
                <SelectTrigger id="plan-script">
                  <SelectValue placeholder="No script" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No script</SelectItem>
                  {scripts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {needsAck && (
                <label className="mt-1 flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={noScriptAck} onCheckedChange={(v) => setNoScriptAck(v === true)} className="mt-0.5" />
                  <span>
                    I don&apos;t have a script yet. This plan will render as a note with a date, distinct from
                    one carrying a script, and gets flagged stale after 30 days if it still has neither.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-video-kind">Video kind</Label>
            <Select value={videoKind || "none"} onValueChange={(v) => setVideoKind(!v || v === "none" ? "" : v)}>
              <SelectTrigger id="plan-video-kind">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {VIDEO_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
