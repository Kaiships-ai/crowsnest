"use client";

/**
 * Shared row + field primitives for the editable `app_settings` rows (Scoring, Feed
 * defaults, Sync). Pulled out because three sections need the same shape: a label, an
 * honest note about where the value comes from or whether anything reads it, and one of
 * two control types (a segmented enum or a bounded number).
 *
 * `SettingRow` never decides wired/source wording itself — the caller passes the exact
 * sentence (see scoring-section.tsx / feed-defaults-section.tsx / sync-section.tsx),
 * because "how do I say this key is unwired" is a product decision per key, not a thing
 * this file should guess at.
 */

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function SettingRow({
  label,
  hint,
  warnNote,
  infoNote,
  children,
}: {
  label: string;
  hint?: string;
  /** Destructive tone — set when this key has no consumer yet (see `WIRED` in
   *  `src/server/settings/index.ts`), never for an ordinary validation message. */
  warnNote?: string;
  /** Muted tone — set when the value's source is worth naming, e.g. "currently read
   *  from SYNC_INTERVAL_MINUTES". Omitted once a database row exists, since a value the
   *  user already saved needs no explanation for where it came from. */
  infoNote?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-[26rem]">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        {warnNote && <p className="mt-1 text-xs text-destructive">{warnNote}</p>}
        {infoNote && <p className="mt-1 text-xs text-muted-foreground">{infoNote}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function EnumField<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(vals: unknown[]) => {
        const next = vals[0] as T | undefined;
        if (next) onChange(next);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} size="sm">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  suffix,
  disabled,
  ariaLabel,
}: {
  /** Kept as a string in local state, same reasoning `add-channel-dialog.tsx` and
   *  friends use for text inputs: an intermediate typed value ("" mid-edit, a leading
   *  "0") must not be coerced to a number and silently clamped while the field still
   *  has focus. Coercion happens once, on save. */
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        className="w-24"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
