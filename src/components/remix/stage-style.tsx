"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { CopyPromptButton } from "@/components/remix/copy-prompt-button";
import { GroundedIn } from "@/components/remix/grounded-in";
import { updateStageAction } from "@/server/actions/remix-actions";
import type { Outline } from "@/server/schemas";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const SOURCE_VALUE = "__source__";
const EMPTY_VALUE = "__empty__";

/** DESIGN.md §2.5 stage ④: "Source video's structure" (default) or a Vault style
 * template, then the beat outline the agent wrote, editable inline. */
export function StageStyle({
  session,
  vaultStyles,
  onOutlineChange,
  onStyleVaultItemChange,
}: {
  session: RemixSessionRow;
  vaultStyles: VaultItemRow[];
  onOutlineChange: (outline: Outline) => void;
  onStyleVaultItemChange: (id: string | null) => void;
}) {
  const [styleChoice, setStyleChoice] = useState(session.styleVaultItemId ?? SOURCE_VALUE);
  // Initialized once from the session prop — this component only mounts while the
  // Style stage is active, so a fresh mount is exactly when session.outline should be
  // picked up again; updateBeat() below is the only thing that changes it
  // afterward, and it already calls setBeats directly — no sync effect needed.
  const [beats, setBeats] = useState(session.outline?.beats ?? []);

  function selectStyle(value: string) {
    setStyleChoice(value);
    const id = value === SOURCE_VALUE ? null : value;
    onStyleVaultItemChange(id);
    autosave(updateStageAction(session.id, { styleVaultItemId: id }));
  }

  // Local edits update state on every keystroke for responsiveness; persisting is
  // deferred to blur (see commitBeats below) so typing doesn't fire a server round
  // trip per character.
  function updateBeat(index: number, patch: Partial<Outline["beats"][number]>) {
    const next = beats.map((beat, i) => (i === index ? { ...beat, ...patch } : beat));
    setBeats(next);
    onOutlineChange({ beats: next });
  }

  function commitBeats() {
    autosave(updateStageAction(session.id, { outline: { beats } }));
  }

  // DESIGN.md §6: an empty Vault never blocks the stage, the prompt still falls back
  // to the source video's own structure — so the empty state is just a disabled
  // option explaining why there's nothing else to pick, not a dead end.
  const styleOptions: { value: string; label: string; disabled?: boolean }[] = [
    { value: SOURCE_VALUE, label: "Source post's structure" },
    ...(vaultStyles.length > 0
      ? vaultStyles.map((item) => ({ value: item.id, label: item.title }))
      : [{ value: EMPTY_VALUE, label: "No saved styles yet", disabled: true }]),
  ];

  // 2026-08-15 spec part 7: names what feeds the outline prompt, read
  // straight off session state already in this component — no server round trip.
  // The structure-beats clause is gated on styleChoice: when a Vault style template is
  // picked, buildOutlinePrompt (remix.ts) uses that template's structure instead of
  // describeSourceStructure, so the source no longer fed the structure (review
  // finding: misattribution when a vault template is selected). whyItWorked stays
  // unconditional — remix.ts passes it regardless of styleVaultItemId.
  const styleAnalysis = session.researchNotes?.sourceAnalysis;
  const usingVaultStyle = styleChoice !== SOURCE_VALUE && styleChoice !== EMPTY_VALUE;
  const vaultStyleTitle = usingVaultStyle ? vaultStyles.find((item) => item.id === styleChoice)?.title : undefined;
  const groundedInParts = [
    usingVaultStyle
      ? `structure (Vault template${vaultStyleTitle ? `: ${vaultStyleTitle}` : ""})`
      : styleAnalysis
        ? "source structure beats (note + transcript)"
        : null,
    styleAnalysis ? "why it worked" : null,
    session.chosenHook ? "chosen hook" : null,
    session.topic ? "your topic" : null,
    session.researchNotes?.facts ? "your facts" : null,
  ].filter((part): part is string => Boolean(part));
  const groundedInText = groundedInParts.length > 0 ? groundedInParts.join(", ") : "nothing yet, fill in Prompt and Research first";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full sm:w-64">
          <FieldContent>
            <FieldLabel htmlFor="style-select">Structure</FieldLabel>
          </FieldContent>
          <Select items={styleOptions} value={styleChoice} onValueChange={(v) => selectStyle(v as string)}>
            <SelectTrigger id="style-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {styleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <CopyPromptButton stage="style" videoId={session.sourceVideoId} />
      </div>

      <GroundedIn>{groundedInText}</GroundedIn>

      {beats.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {beats.map((beat, i) => (
            <li key={i}>
              <Card size="sm">
                <CardContent className="flex gap-3">
                  <Input
                    value={String(beat.targetSec)}
                    onChange={(e) => updateBeat(i, { targetSec: Number(e.target.value) || 0 })}
                    onBlur={commitBeats}
                    className="w-16 shrink-0 text-center font-mono tabular-nums"
                    aria-label={`Beat ${i + 1} target seconds`}
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Input
                      value={beat.label}
                      onChange={(e) => updateBeat(i, { label: e.target.value })}
                      onBlur={commitBeats}
                      className="font-medium"
                      aria-label={`Beat ${i + 1} label`}
                    />
                    <Textarea
                      value={beat.content}
                      onChange={(e) => updateBeat(i, { content: e.target.value })}
                      onBlur={commitBeats}
                      rows={2}
                      className="text-sm"
                      aria-label={`Beat ${i + 1} content`}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No outline yet. Copy the prompt into Claude, then reload to see what it wrote.</p>
      )}
    </div>
  );
}
