"use client";

/**
 * The Persona surface (Task 6): audience, voice, do, and do-not — the four fields
 * `remix.ts` now reads alongside the niche profile for every generation stage (see
 * `savePersonaAction` / `getPersona`, Task 5). Own route (`/persona`) rather than a
 * Settings section, since the mockup and the nav both treat it as a first-class screen
 * under Setup, not one more collapsible panel.
 *
 * Structured like `secrets-section.tsx`: one bordered row per field, `useTransition`
 * around the save action, a toast on each outcome. `setting-field.tsx`'s `SettingRow` is
 * a poor fit here — it lays a label beside a compact single-line control, and all four
 * fields here are open-ended paragraphs — so this follows `secrets-section.tsx`'s own
 * row shape instead (a bordered box, label on top, control below).
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePersonaAction } from "@/server/actions/persona-actions";
import type { Persona } from "@/server/services/persona";

const FIELDS: { key: keyof Persona; label: string; placeholder: string }[] = [
  { key: "audience", label: "Audience", placeholder: "Who this content is for." },
  { key: "voice", label: "Voice", placeholder: "Tone and style every script should sound like." },
  { key: "do", label: "Do", placeholder: "Things every generation should do." },
  { key: "dont", label: "Do not", placeholder: "Things every generation should avoid." },
];

export function PersonaSection({ initial }: { initial: Persona }) {
  const [values, setValues] = useState<Persona>(initial);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await savePersonaAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setValues(result.persona);
      toast.success("Persona saved.");
    });
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Persona</h2>
        <p className="text-sm text-muted-foreground">Every Remix generation stage reads this alongside the niche profile.</p>
      </div>

      <div className="flex flex-col gap-2">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5 border border-border p-3">
            <Label htmlFor={`persona-${field.key}`}>{field.label}</Label>
            <Textarea
              id={`persona-${field.key}`}
              value={values[field.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              rows={3}
              disabled={pending}
            />
          </div>
        ))}
      </div>

      {/* The one amber primary on this screen (WAVE2-BRIEF's one-per-screen rule) —
       *  nothing else here competes for it. */}
      <Button onClick={save} disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save persona"}
      </Button>
    </section>
  );
}
