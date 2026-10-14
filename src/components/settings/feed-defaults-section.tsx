"use client";

/**
 * `feedDefaultMinScore` and `feedDefaultFollowerBand` — `WIRED: false` in
 * `src/server/settings/index.ts` because the feed screen has no server-side default
 * yet; a bare visit opens on the Balanced preset instead. These rows are real and save to `app_settings` like
 * any other setting, but showing a number here without saying that plainly would be
 * exactly the fabricated-capability bug the truth pass exists to remove (WAVE2-BRIEF).
 * So every row carries its "not read yet" line — same treatment sync-section.tsx
 * already gives `mediaRetentionDays` and `syncCadenceMinutes`.
 */

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { EnumField, NumberField, SettingRow } from "./setting-field";
import { numberFieldError } from "./number-validation";
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

  const minScoreError = numberFieldError(minScore, { min: 0, max: 1000 });

  async function save() {
    setSaving(true);
    const result = await updateAppSettingsAction({ feedDefaultMinScore: Number(minScore), feedDefaultFollowerBand: band });
    setSaving(false);
    if (result.ok) toast.success("Feed defaults saved");
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feed defaults</CardTitle>
        <CardDescription>What the feed would open to. Neither row below is read by the feed yet.</CardDescription>
      </CardHeader>

      <CardContent>
        <FieldGroup>
          <SettingRow
            label="Default minimum score"
            hint="The score filter the feed would open with."
            htmlFor="feed-default-min-score"
            error={minScoreError}
            warnNote="Not read yet. A bare visit to the feed opens on the Balanced preset, a minimum score of 5 over 30 days, not on this number."
          >
            <NumberField value={minScore} onChange={setMinScore} min={0} max={1000} suffix="x" />
          </SettingRow>
          <SettingRow
            label="Default follower band"
            hint="The band chip the feed would open with."
            warnNote="Not read yet. The feed always opens on every band, regardless of this setting."
          >
            <EnumField value={band} onChange={setBand} options={BAND_OPTIONS} ariaLabel="Default follower band" />
          </SettingRow>
        </FieldGroup>
      </CardContent>

      <CardFooter>
        <Button onClick={save} disabled={!dirty || minScoreError !== null || saving} size="sm" variant="outline">
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
