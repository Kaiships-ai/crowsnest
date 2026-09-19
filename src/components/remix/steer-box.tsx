"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  return (
    <div className="flex flex-col gap-2 border border-border bg-muted/20 p-3">
      <Label className="font-mono text-2xs tracking-wide text-success uppercase">Comment to regenerate</Label>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} rows={2} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => onRegenerate(note)} disabled={pending}>
          {pending ? "Regenerating…" : "Regenerate with note"}
        </Button>
        <p className="text-2xs text-muted-foreground">Your note is added to the same source inputs, then this step reruns.</p>
      </div>
    </div>
  );
}
