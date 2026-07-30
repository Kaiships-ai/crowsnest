"use client";

/**
 * `feedDefaultMinScore` and `feedDefaultFollowerBand` — `WIRED: false` in
 * `src/server/settings/index.ts` because the feed screen has no server-side default
 * yet; it always opens unfiltered. These rows are real and save to `app_settings` like
 * any other setting, but showing a number here without saying that plainly would be
 * exactly the fabricated-capability bug the truth pass exists to remove (WAVE2-BRIEF).
 * So every row carries its "not read yet" line — same treatment sync-section.tsx
 * already gives `mediaRetentionDays` and `syncCadenceMinutes`.
 */

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EnumField, NumberField, SettingRow } from "./setting-field";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { AppSettingsView } from "@/server/settings";

type FeedDefaultSettings = Pick<AppSettingsView, "feedDefaultMinScore" | "feedDefaultFollowerBand">;

const BAND_OPTIONS = [
  { value: "all" as const, label: "All" },
  { value: "nano" as const, label: "Nano" },
  { value: "micro" as const, label: "Micro" },
  { value: "mid" as const, label: "Mid" },
  { value: "macro" as const, label: "Macro" },
];

export function FeedDefaultsSection({ initial }: { initial: FeedDefaultSettings }) {
  const [minScore, setMinScore] = useState(String(initial.feedDefaultMinScore.value));
  const [band, setBand] = useState(initial.feedDefaultFollowerBand.value);
  const [saving, setSaving] = useState(false);

  const dirty = minScore !== String(initial.feedDefaultMinScore.value) || band !== initial.feedDefaultFollowerBand.value;

  async function save() {
    setSaving(true);
    const result = await updateAppSettingsAction({ feedDefaultMinScore: Number(minScore), feedDefaultFollowerBand: band });
    setSaving(false);
    if (result.ok) toast.success("Feed defaults saved");
    else toast.error(result.error);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Feed defaults</h2>
        <p className="text-sm text-muted-foreground">What the feed would open to. Neither row below is read by the feed yet.</p>
      </div>

      <div className="flex flex-col gap-2">
        <SettingRow
          label="Default minimum score"
          hint="The score filter the feed would open with."
          warnNote="Not read yet. The feed always opens unfiltered, regardless of this number."
        >
          <NumberField value={minScore} onChange={setMinScore} min={0} max={1000} suffix="x" ariaLabel="Default minimum score" />
        </SettingRow>
        <SettingRow
          label="Default follower band"
          hint="The band chip the feed would open with."
          warnNote="Not read yet. The feed always opens on All, regardless of this setting."
        >
          <EnumField value={band} onChange={setBand} options={BAND_OPTIONS} ariaLabel="Default follower band" />
        </SettingRow>
      </div>

      <Button onClick={save} disabled={!dirty || saving} className="w-fit" size="sm" variant="outline">
        {saving ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}
