"use client";

/**
 * The Persona surface (Task 6): audience, voice, do, and do-not — the four fields
 * `remix.ts` now reads alongside the niche profile for every generation stage (see
 * `savePersonaAction` / `getPersona`, Task 5). Own route (`/persona`) rather than a
 * Settings section, since the mockup and the nav both treat it as a first-class screen
 * under Setup, not one more collapsible panel.
 *
 * One `Card` holding a `FieldGroup` of four `Field`s, `useTransition` around the save
 * action, a toast on each outcome. `setting-field.tsx`'s `SettingRow` is a poor fit
 * here — it lays a label beside a compact single-line control, and all four fields here
 * are open-ended paragraphs — so each row is a plain vertical `Field` instead: label on
 * top, the "why" line under it, textarea below.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
    <Card>
      <CardHeader>
        <CardTitle>Persona</CardTitle>
        <CardDescription>
          Optional, but it sharpens every remix. Claude reads it over MCP alongside your niche profile when it writes a remix; leave a
          field blank and it falls back to the niche.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <FieldGroup>
          {FIELDS.map((field) => {
            const empty = !values[field.key].trim();
            const id = `persona-${field.key}`;
            return (
              <Field key={field.key}>
                {/* Label left, its example action right: a row rather than the Field's
                    own stack, because the button belongs to this label, not to the
                    textarea below it. */}
                <div className="flex items-baseline justify-between gap-3">
                  <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
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
                <FieldDescription>{field.why}</FieldDescription>
                <Textarea
                  id={id}
                  value={values[field.key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={3}
                  disabled={pending}
                />
              </Field>
            );
          })}
        </FieldGroup>
      </CardContent>

      {/* The one primary button on this screen (WAVE2-BRIEF's one-per-screen rule) —
       *  nothing else here competes for it. */}
      <CardFooter className="gap-3">
        <Button onClick={save} disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save persona"}
        </Button>
        {dirty && !pending && (
          <span data-testid="persona-dirty" className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">
            Unsaved changes
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
