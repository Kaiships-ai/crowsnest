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
 *
 * The row owns the label/control association and the validation message; the control
 * reads both off `SettingFieldContext` rather than taking them as duplicate props. A row
 * with a real input passes `htmlFor` and gets a `<label for>`; a row whose control is a
 * toggle group does not, because `for` may only point at a labelable element, and
 * `EnumField`'s own `aria-label` already names the group.
 */

import { createContext, useContext, type ReactNode } from "react";

import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const SettingFieldContext = createContext<{ controlId?: string; invalid: boolean }>({ invalid: false });

export function SettingRow({
  label,
  hint,
  htmlFor,
  error,
  warnNote,
  infoNote,
  children,
}: {
  label: string;
  hint?: string;
  /** The id of the input this row labels. Omitted for a toggle-group row. */
  htmlFor?: string;
  /** From `numberFieldError` (number-validation.ts). Renders as the row's `FieldError`
   *  (a `role="alert"` node) and marks the control `aria-invalid`. */
  error?: string | null;
  /** Destructive tone — set when this key has no consumer yet (see `WIRED` in
   *  `src/server/settings/index.ts`), never for an ordinary validation message. */
  warnNote?: string;
  /** Muted tone — set when the value's source is worth naming, e.g. "currently read
   *  from SYNC_INTERVAL_MINUTES". Omitted once a database row exists, since a value the
   *  user already saved needs no explanation for where it came from. */
  infoNote?: string;
  children: ReactNode;
}) {
  const invalid = Boolean(error);

  return (
    <Field orientation="responsive" data-invalid={invalid || undefined}>
      <FieldContent>
        {htmlFor ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : <FieldTitle>{label}</FieldTitle>}
        {hint && <FieldDescription>{hint}</FieldDescription>}
        {warnNote && <FieldError>{warnNote}</FieldError>}
        {infoNote && <FieldDescription>{infoNote}</FieldDescription>}
        {error && <FieldError>{error}</FieldError>}
      </FieldContent>
      <SettingFieldContext.Provider value={{ controlId: htmlFor, invalid }}>{children}</SettingFieldContext.Provider>
    </Field>
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
  /** Only for a control outside a `SettingRow`. Inside one, the row's label names it. */
  ariaLabel?: string;
}) {
  const { controlId, invalid } = useContext(SettingFieldContext);

  return (
    <InputGroup className="w-40">
      <InputGroupInput
        id={controlId}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
