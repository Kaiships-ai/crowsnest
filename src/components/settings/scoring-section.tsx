"use client";

/**
 * The four keys that change what a score MEANS (`SCORE_MEANING_KEYS` in
 * settings-actions.ts): baseline statistic, baseline window, minimum usable posts,
 * views floor. `updateAppSettingsAction` recomputes every stored score in one
 * transaction the moment any of these four changes, and rolls back the whole write —
 * settings included — if that recompute fails partway.
 *
 * That consequence has to be visible before the click, not after, so saving here is a
 * two-step: edit, then a confirm dialog that says in plain words what is about to
 * happen and how long-ish it might take. There is no per-field autosave — batching all
 * four into one save is what makes the confirm dialog make sense (confirming four
 * separate times for four fields that only take effect together would just be four
 * dialogs to click through, not four decisions).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EnumField, NumberField, SettingRow } from "./setting-field";
import { numberFieldError } from "./number-validation";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { AppSettingsView } from "@/server/settings";

type ScoringSettings = Pick<AppSettingsView, "scoreBaselineMethod" | "scoreBaselineWindow" | "scoreMinUsablePosts" | "scoreMinViewsFloor">;

const METHOD_OPTIONS = [
  { value: "median" as const, label: "Median" },
  { value: "mean" as const, label: "Mean" },
  { value: "trimmedMean" as const, label: "Trimmed mean" },
];

const WINDOW_OPTIONS = [
  { value: "last12Posts" as const, label: "Last 12 posts" },
  { value: "last30Days" as const, label: "Last 30 days" },
  { value: "allHistory" as const, label: "All history" },
];

export function ScoringSection({ initial }: { initial: ScoringSettings }) {
  const router = useRouter();
  const [method, setMethod] = useState(initial.scoreBaselineMethod.value);
  const [windowSpec, setWindowSpec] = useState(initial.scoreBaselineWindow.value);
  const [minUsable, setMinUsable] = useState(String(initial.scoreMinUsablePosts.value));
  const [minViews, setMinViews] = useState(String(initial.scoreMinViewsFloor.value));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const dirty =
    method !== initial.scoreBaselineMethod.value ||
    windowSpec !== initial.scoreBaselineWindow.value ||
    minUsable !== String(initial.scoreMinUsablePosts.value) ||
    minViews !== String(initial.scoreMinViewsFloor.value);

  const minUsableError = numberFieldError(minUsable, { min: 1, max: 1000, integer: true });
  const minViewsError = numberFieldError(minViews, { min: 0, max: 1_000_000_000, integer: true });
  const hasError = minUsableError !== null || minViewsError !== null;

  async function commit() {
    setSaving(true);
    setFailure(null);
    const result = await updateAppSettingsAction({
      scoreBaselineMethod: method,
      scoreBaselineWindow: windowSpec,
      scoreMinUsablePosts: Number(minUsable),
      scoreMinViewsFloor: Number(minViews),
    });
    setSaving(false);
    if (result.ok) {
      setConfirmOpen(false);
      toast.success("Scoring settings saved. Every stored score was recomputed to match.");
      router.refresh();
      return;
    }
    // Transactional: the settings rows and the recompute either both landed or neither
    // did. Say that plainly rather than leaving the dialog looking like a normal
    // validation error — nothing on screen changed, including fields that "looked" fine.
    setFailure(result.error);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Scoring</h2>
        <p className="text-sm text-muted-foreground">
          Defines what a score means. Changing any row below recomputes every stored score under the new rule before the save returns.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SettingRow label="Baseline statistic" hint="Which number defines &ldquo;normal&rdquo; for a channel.">
          <EnumField value={method} onChange={setMethod} options={METHOD_OPTIONS} ariaLabel="Baseline statistic" />
        </SettingRow>
        <SettingRow label="Baseline window" hint="How far back the baseline looks.">
          <EnumField value={windowSpec} onChange={setWindowSpec} options={WINDOW_OPTIONS} ariaLabel="Baseline window" />
        </SettingRow>
        <SettingRow label="Minimum usable posts" hint="Fewer usable posts than this and a channel gets no score at all.">
          <NumberField
            value={minUsable}
            onChange={setMinUsable}
            min={1}
            max={1000}
            suffix="posts"
            ariaLabel="Minimum usable posts"
            error={minUsableError}
          />
        </SettingRow>
        <SettingRow label="Views floor" hint="Posts below this many views are excluded from the baseline. 0 means no floor.">
          <NumberField
            value={minViews}
            onChange={setMinViews}
            min={0}
            max={1_000_000_000}
            suffix="views"
            ariaLabel="Views floor"
            error={minViewsError}
          />
        </SettingRow>
      </div>

      <Button onClick={() => setConfirmOpen(true)} disabled={!dirty || hasError || saving} className="w-fit" size="sm">
        Save (rescores every post)
      </Button>

      <Dialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next);
          if (!next) setFailure(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rescore every stored post?</DialogTitle>
            <DialogDescription>
              Changing the baseline changes what every score in this app means. Saving recomputes the outlier score for every channel right
              now, in one pass. It can take a moment on a large database, and it runs as a single transaction: if it fails partway, nothing
              changes, not the scores and not this setting.
            </DialogDescription>
          </DialogHeader>
          {failure && <p className="text-sm text-destructive">Nothing changed. The save was rolled back: {failure}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={saving}>
              {saving ? "Rescoring…" : "Rescore and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
