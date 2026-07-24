"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { generateOutlineAction, updateStageAction } from "@/server/actions/remix-actions";
import type { Outline } from "@/server/llm/schemas";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const SOURCE_VALUE = "__source__";

/** DESIGN.md §2.5 stage ④: same seed-then-generate shape as Hook — "Source video's
 * structure" (default) or a Vault style template, then an editable beat outline
 * (labels/content/timing edited inline, not just picked as-is). */
export function StageStyle({
  session,
  vaultStyles,
  hasLlmKey,
  onOutlineChange,
  onStyleVaultItemChange,
}: {
  session: RemixSessionRow;
  vaultStyles: VaultItemRow[];
  hasLlmKey: boolean;
  onOutlineChange: (outline: Outline) => void;
  onStyleVaultItemChange: (id: string | null) => void;
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
    void updateStageAction(session.id, { styleVaultItemId: id });
  }

  async function generate() {
    setGenerating(true);
    const result = await generateOutlineAction(session.id);
    setGenerating(false);
    if (result.ok) {
      onOutlineChange(result.outline);
      setBeats(result.outline.beats);
    } else {
      toast.error(result.error);
    }
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
    void updateStageAction(session.id, { outline: { beats } });
  }

  const styleOptions = [
    { value: SOURCE_VALUE, label: "Source video's structure" },
    ...vaultStyles.map((item) => ({ value: item.id, label: item.title })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="style-select">Structure</Label>
          <Select items={styleOptions} value={styleChoice} onValueChange={(v) => selectStyle(v as string)}>
            <SelectTrigger id="style-select" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {styleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={generate} disabled={!hasLlmKey || generating}>
          {generating ? "Generating…" : beats.length > 0 ? "Regenerate outline" : "Generate outline"}
        </Button>
      </div>

      {!hasLlmKey && (
        <Alert>
          <AlertTitle>Add your Claude API key</AlertTitle>
          <AlertDescription>Add ANTHROPIC_API_KEY in Settings to generate an outline.</AlertDescription>
        </Alert>
      )}

      {generating ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : beats.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {beats.map((beat, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-border p-3">
              <Input
                value={String(beat.targetSec)}
                onChange={(e) => updateBeat(i, { targetSec: Number(e.target.value) || 0 })}
                onBlur={commitBeats}
                className="w-16 shrink-0 text-center tabular-nums"
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
      ) : (
        <p className="text-sm text-muted-foreground">Generate an outline to get started.</p>
      )}
    </div>
  );
}
