"use client";

/**
 * "What do you make?" — docs/product/v1-scope.md §2 AC 3–4. Writes the same
 * `app_settings.niche_profile` key the Settings page's Niche Profile section already
 * reads and writes (`saveNicheSettingsAction`), so this screen and Settings can never
 * disagree about what's stored.
 *
 * The prototype also asks how often you post ("cadence"). Cut here per the ruling: no
 * code path in this app reads that value (v1-scope.md §3, explicit cuts), and a control
 * that changes nothing is exactly the bug the truth pass exists to remove.
 *
 * Subject is a short pick-list rather than a free-text field on this one screen, even
 * though the stored value is an arbitrary string — "Continue disabled until a subject is
 * selected" (AC 4) reads far more naturally as a choice than as "field is non-empty".
 * Anyone who wants something the list doesn't offer can already say so verbatim later:
 * this same value is a plain Textarea on the Settings page.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveNicheSettingsAction } from "@/server/actions/settings-actions";

const SUBJECTS = ["Beauty & grooming", "Fitness & coaching", "Food & recipes", "Business & finance"] as const;
const OTHER = "Other";

function isPreset(value: string): value is (typeof SUBJECTS)[number] {
  return (SUBJECTS as readonly string[]).includes(value);
}

export interface FocusStepProps {
  initialNiche: string;
  /** Passed straight back to `saveNicheSettingsAction` unchanged, same as the Settings
   *  page's own Niche Profile section does — this screen has no keyword field, and a
   *  save from here must not silently wipe whatever's already stored. */
  initialKeywords: string[];
  onBack: () => void;
  onContinue: (niche: string) => void;
}

export function FocusStep({ initialNiche, initialKeywords, onBack, onContinue }: FocusStepProps) {
  const [mode, setMode] = useState<"preset" | "other">(isPreset(initialNiche) ? "preset" : "other");
  const [preset, setPreset] = useState<string | null>(isPreset(initialNiche) ? initialNiche : null);
  const [customText, setCustomText] = useState(isPreset(initialNiche) ? "" : initialNiche);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = mode === "preset" ? preset : customText.trim();
  const canContinue = Boolean(selected);

  async function handleContinue() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const result = await saveNicheSettingsAction(selected, initialKeywords);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onContinue(selected);
  }

  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-muted-foreground">01 · FOCUS</span>
      <h1 className="mt-4 text-xl leading-tight font-bold tracking-tight">What do you make?</h1>
      <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-muted-foreground text-balance">
        This shapes the channels step right after this one, and every remix you generate. Changeable later in
        Settings.
      </p>

      <div className="mt-11">
        <span className="font-mono text-2xs tracking-wide text-muted-foreground">SUBJECT</span>
        <div className="mt-2 flex max-w-[460px] flex-col">
          {SUBJECTS.map((label) => {
            const isSelected = mode === "preset" && preset === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setMode("preset");
                  setPreset(label);
                }}
                aria-pressed={isSelected}
                className="flex items-center gap-3 border-b border-border py-3.5 text-left"
              >
                <span
                  aria-hidden
                  className={`size-3 flex-none ${isSelected ? "bg-foreground" : "bg-transparent ring-1 ring-inset ring-border"}`}
                />
                <span className={`text-base ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMode("other")}
            aria-pressed={mode === "other"}
            className="flex items-center gap-3 border-b border-border py-3.5 text-left"
          >
            <span
              aria-hidden
              className={`size-3 flex-none ${mode === "other" ? "bg-foreground" : "bg-transparent ring-1 ring-inset ring-border"}`}
            />
            <span className={`text-base ${mode === "other" ? "text-foreground" : "text-muted-foreground"}`}>{OTHER}</span>
          </button>
        </div>

        {mode === "other" && (
          <Textarea
            className="mt-3 max-w-[460px]"
            placeholder="Describe your audience and content style"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={3}
            aria-label="Describe your subject"
          />
        )}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-11 flex flex-wrap items-center gap-7">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={() => void handleContinue()} disabled={!canContinue || saving}>
          {saving ? "Saving…" : "Continue"}
        </Button>
        {!canContinue && <span className="font-mono text-xs text-muted-foreground">Pick a subject to continue</span>}
      </div>
    </div>
  );
}
