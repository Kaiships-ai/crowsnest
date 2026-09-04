"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { GenerationBlocked } from "@/components/remix/generation-blocked";
import { GeneratingSkeleton } from "@/components/remix/generating-skeleton";
import { GroundedIn } from "@/components/remix/grounded-in";
import { SteerBox } from "@/components/remix/steer-box";
import { generateOutlineAction, updateStageAction } from "@/server/actions/remix-actions";
import type { Outline } from "@/server/llm/schemas";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const SOURCE_VALUE = "__source__";
const EMPTY_VALUE = "__empty__";

/** DESIGN.md §2.5 stage ④: same seed-then-generate shape as Hook — "Source video's
 * structure" (default) or a Vault style template, then an editable beat outline
 * (labels/content/timing edited inline, not just picked as-is). */
export function StageStyle({
  session,
  vaultStyles,
  hasLlmKey,
  proxyDown,
  llmProxyUrl,
  onOutlineChange,
  onStyleVaultItemChange,
  onRunRecorded,
}: {
  session: RemixSessionRow;
  vaultStyles: VaultItemRow[];
  hasLlmKey: boolean;
  proxyDown: boolean;
  llmProxyUrl: string | null;
  onOutlineChange: (outline: Outline) => void;
  onStyleVaultItemChange: (id: string | null) => void;
  onRunRecorded: () => void;
}) {
  const [styleChoice, setStyleChoice] = useState(session.styleVaultItemId ?? SOURCE_VALUE);
  const [generating, setGenerating] = useState(false);
  // Initialized once from the session prop — this component only mounts while the
  // Style stage is active, so a fresh mount is exactly when session.outline should be
  // picked up again; generate()/updateBeat() below are the only things that change it
  // afterward, and both already call setBeats directly — no sync effect needed.
  const [beats, setBeats] = useState(session.outline?.beats ?? []);

  function selectStyle(value: string) {
    setStyleChoice(value);
    const id = value === SOURCE_VALUE ? null : value;
    onStyleVaultItemChange(id);
    autosave(updateStageAction(session.id, { styleVaultItemId: id }));
  }

  async function generate(steer?: string) {
    setGenerating(true);
    const result = await generateOutlineAction(session.id, steer);
    setGenerating(false);
    if (result.ok) {
      onOutlineChange(result.outline);
      setBeats(result.outline.beats);
    } else {
      toast.error(result.error);
    }
    onRunRecorded();
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

  // DESIGN.md §6: an empty Vault never blocks the stage — generation still falls back
  // to the source video's own structure — so the empty state is just a disabled
  // option explaining why there's nothing else to pick, not a dead end.
  const styleOptions: { value: string; label: string; disabled?: boolean }[] = [
    { value: SOURCE_VALUE, label: "Source post's structure" },
    ...(vaultStyles.length > 0
      ? vaultStyles.map((item) => ({ value: item.id, label: item.title }))
      : [{ value: EMPTY_VALUE, label: "No saved styles yet", disabled: true }]),
  ];

  // 2026-08-15 spec part 7: names what fed the last/next outline generation, read
  // straight off session state already in this component — no server round trip.
  // The structure-beats clause is gated on styleChoice: when a Vault style template is
  // picked, generateOutline (remix.ts) uses that template's structure instead of
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

  // Same posture as Hook/Script: block the whole stage rather than gray out a
  // toolbar that can't do anything, whether the reason is no key or the local
  // proxy being unreachable (generation-blocked.tsx).
  if (!hasLlmKey || proxyDown) {
    return <GenerationBlocked reason={!hasLlmKey ? "no-key" : "proxy-down"} feature="Outline generation" proxyUrl={llmProxyUrl} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="style-select" className="font-mono text-2xs tracking-wide text-faint uppercase">
            Structure
          </Label>
          <Select items={styleOptions} value={styleChoice} onValueChange={(v) => selectStyle(v as string)}>
            <SelectTrigger id="style-select" className="w-64">
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
        </div>
        {/* Secondary, not primary — Continue in the footer stays the one amber action. */}
        <Button variant="secondary" onClick={() => generate()} disabled={generating}>
          {generating ? "Generating…" : beats.length > 0 ? "Regenerate outline" : "Generate outline"}
        </Button>
      </div>

      <GroundedIn>{groundedInText}</GroundedIn>

      {generating ? (
        <GeneratingSkeleton label="Generating outline…" count={4} rowClassName="h-16" />
      ) : beats.length > 0 ? (
        <>
        <ol className="flex flex-col gap-3">
          {beats.map((beat, i) => (
            <li key={i} className="flex gap-3 border border-border p-3">
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
                />
              </div>
            </li>
          ))}
        </ol>
        <SteerBox
          placeholder="e.g. add a beat before the payoff, tighten the build"
          pending={generating}
          onRegenerate={(note) => generate(note)}
        />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Generate an outline to get started.</p>
      )}
    </div>
  );
}
