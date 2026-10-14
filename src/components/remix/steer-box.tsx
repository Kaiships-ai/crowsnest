"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/** 2026-08-15 spec part 6: the "comment to regenerate" box on hook, style, and the
 *  active script variant. The note is local, per-invocation state — never persisted —
 *  matching the prototype's steer box; a fresh mount (moving to a new stage and back)
 *  starts it empty again. Shared by stage-hook.tsx, stage-style.tsx, and
 *  stage-script.tsx. */
export function SteerBox({
  placeholder,
  pending,
  onRegenerate,
}: {
  placeholder: string;
  pending: boolean;
  onRegenerate: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  // The Script stage mounts one of these per variant tab, so the label/control pairing
  // needs an id that is unique per instance rather than a hardcoded string.
  const noteId = useId();

  return (
    <Card size="sm">
      <CardContent>
        <Field>
          <FieldLabel htmlFor={noteId}>Comment to regenerate</FieldLabel>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={placeholder}
            rows={2}
          />
        </Field>
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <Button size="sm" variant="secondary" onClick={() => onRegenerate(note)} disabled={pending}>
          {pending ? "Regenerating…" : "Regenerate with note"}
        </Button>
        <p className="text-2xs text-muted-foreground">Your note is added to the same source inputs, then this step reruns.</p>
      </CardFooter>
    </Card>
  );
}
