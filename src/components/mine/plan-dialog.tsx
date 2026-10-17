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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createPlannedPostAction,
  savePlanEditAction,
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
      toast.success(date ? "Đã lên lịch" : "Đã lưu bản nháp");
      reset();
      onOpenChange(false);
      onSaved();
      router.refresh();
      return;
    }

    // Edit mode: apply the whole edit as one atomic action (B-04). Only the fields that
    // changed are sent; savePlanEditAction validates all of them, then writes them in a
    // single transaction, so a failure never leaves a partial edit.
    const planRow = plan!;
    const edit: Parameters<typeof savePlanEditAction>[1] = {};
    if (title.trim() !== planRow.title) edit.title = title.trim();
    if (note.trim() !== (planRow.note ?? "")) edit.note = note.trim();
    if (date !== (planRow.plannedDate ?? "")) edit.date = date || null;
    if (scriptId !== (planRow.scriptId ?? "")) edit.scriptId = scriptId || null;
    if (videoKind !== (planRow.videoKind ?? "")) edit.videoKind = videoKind || null;

    const r = await savePlanEditAction(planRow.id, edit);
    if (!r.ok) {
      setSaving(false);
      setError(r.error);
      return;
    }
    setSaving(false);
    toast.success("Đã lưu plan");
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
          <DialogTitle>{isEdit ? "Sửa plan" : "Plan mới"}</DialogTitle>
          <DialogDescription>
            Đổi ngày giữ nguyên giờ hẹn đăng. Bỏ trống ngày thì reel về bản nháp và huỷ lịch đăng.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="plan-title">Tiêu đề</FieldLabel>
            <Input
              id="plan-title"
              data-testid="plan-dialog-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reel này nói về gì"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="plan-date">Ngày</FieldLabel>
            <Input id="plan-date" data-testid="plan-dialog-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <FieldDescription>Bỏ trống để giữ làm bản nháp chưa có ngày.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="plan-note">Ghi chú</FieldLabel>
            <Textarea id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" />
          </Field>

          {carriesRemix ? (
            <FieldDescription>
              Plan này mang kịch bản từ một lượt remix, nên không gỡ kịch bản ở đây được.
            </FieldDescription>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="plan-script">Kịch bản</FieldLabel>
                <Select value={scriptId || "none"} onValueChange={(v) => setScriptId(!v || v === "none" ? "" : v)}>
                  <SelectTrigger id="plan-script" data-testid="plan-dialog-script">
                    <SelectValue placeholder="Chưa có kịch bản" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Chưa có kịch bản</SelectItem>
                    {scripts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {needsAck && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="plan-no-script-ack"
                    data-testid="plan-dialog-no-script-ack"
                    checked={noScriptAck}
                    onCheckedChange={(v) => setNoScriptAck(v === true)}
                  />
                  <FieldLabel htmlFor="plan-no-script-ack" className="font-normal text-muted-foreground">
                    Mình chưa có kịch bản. Plan sẽ hiện như một ghi chú có ngày, và bị đánh dấu cũ sau 30 ngày nếu
                    vẫn chưa có kịch bản.
                  </FieldLabel>
                </Field>
              )}
            </>
          )}

          <Field>
            <FieldLabel htmlFor="plan-video-kind">Loại video</FieldLabel>
            <Select value={videoKind || "none"} onValueChange={(v) => setVideoKind(!v || v === "none" ? "" : v)}>
              <SelectTrigger id="plan-video-kind" data-testid="plan-dialog-video-kind">
                <SelectValue placeholder="Chưa chọn" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Chưa chọn</SelectItem>
                {VIDEO_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={save} data-testid="plan-dialog-save" disabled={!canSave || saving}>
            {saving ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Tạo plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
