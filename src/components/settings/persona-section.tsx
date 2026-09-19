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

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { personaIsDirty } from "@/components/settings/persona-dirty";
import { savePersonaAction } from "@/server/actions/persona-actions";
import type { Persona } from "@/server/services/persona";

const FIELDS: { key: keyof Persona; label: string; placeholder: string; why: string; example: string }[] = [
  {
    key: "audience",
    label: "Audience",
    placeholder: "Who you make this for — niche, level, what they want. Steers who every script talks to.",
    why: "Sets who every generated hook and script is written for.",
    example: "Early-stage SaaS founders who code. Want blunt, tactical advice with no fluff.",
  },
  {
    key: "voice",
    label: "Voice",
    placeholder: "The tone every script should sound like. Steers word choice and rhythm.",
    why: "Shapes the wording and rhythm of every hook, outline and variant.",
    example: "Direct, dry, a little contrarian. Short sentences. No hype words, no emoji.",
  },
  {
    key: "do",
    label: "Do",
    placeholder: "Things every generation should do. Steers structure and what gets included.",
    why: "Rules the model follows in every generation.",
    example: "Open with a concrete number. End on one clear takeaway. Use real examples.",
  },
  {
    key: "dont",
    label: "Do not",
    placeholder: "Things every generation should avoid. Steers what gets filtered out.",
    why: "Rules the model avoids in every generation.",
    example: "No \"in today's world\" intros. No generic advice. No like-and-subscribe lines.",
  },
];

export function PersonaSection({ initial }: { initial: Persona }) {
  const [values, setValues] = useState<Persona>(initial);
  const [saved, setSaved] = useState<Persona>(initial);
  const [pending, startTransition] = useTransition();
  const dirty = personaIsDirty(saved, values);

  // Reload / tab-close / hard-nav guard only. Soft (Next Link) navigation is not
  // intercepted — see the plan's deferral note. Registered only while dirty so a
  // clean form never triggers the native prompt.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "You have unsaved persona edits.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function save() {
    startTransition(async () => {
      const result = await savePersonaAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setValues(result.persona);
      setSaved(result.persona);
      toast.success("Persona saved.");
    });
  }

  // Fills an EMPTY field with its example on explicit click — never overwrites real
  // text (no-fabricated-data: an example must not masquerade as the user's own value).
  function insertExample(field: (typeof FIELDS)[number]) {
    setValues((prev) => (prev[field.key].trim() ? prev : { ...prev, [field.key]: field.example }));
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Persona</h2>
        <p className="text-sm text-muted-foreground">
          Optional, but it sharpens every remix. Each generation stage reads this alongside your niche profile; leave a
          field blank and it falls back to the niche.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {FIELDS.map((field) => {
          const empty = !values[field.key].trim();
          return (
            <div key={field.key} className="flex flex-col gap-1.5 border border-border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`persona-${field.key}`}>{field.label}</Label>
                {empty && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid={`persona-example-${field.key}`}
                    onClick={() => insertExample(field)}
                    disabled={pending}
                  >
                    Insert example
                  </Button>
                )}
              </div>
              <p className="text-2xs text-muted-foreground">{field.why}</p>
              <Textarea
                id={`persona-${field.key}`}
                value={values[field.key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                rows={3}
                disabled={pending}
              />
            </div>
          );
        })}
      </div>

      {/* The one amber primary on this screen (WAVE2-BRIEF's one-per-screen rule) —
       *  nothing else here competes for it. */}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save persona"}
        </Button>
        {dirty && !pending && (
          <span data-testid="persona-dirty" className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">
            Unsaved changes
          </span>
        )}
      </div>
    </section>
  );
}
