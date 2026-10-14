"use client";

import { useId, useState } from "react";
import { Bookmark, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { GenerationBlocked } from "@/components/remix/generation-blocked";
import { GeneratingSkeleton } from "@/components/remix/generating-skeleton";
import { GroundedIn } from "@/components/remix/grounded-in";
import { SteerBox } from "@/components/remix/steer-box";
import { cn } from "@/lib/utils";
import { generateHooksAction, updateStageAction } from "@/server/actions/remix-actions";
import { createVaultItemAction } from "@/server/actions/vault-actions";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const NONE_VALUE = "__none__";
const EMPTY_VALUE = "__empty__";

/** DESIGN.md §2.5 stage ③: optional Vault-hook seed, "Generate hooks" -> 3-7 editable
 * option Cards each with use/save-to-Vault actions; the chosen hook stays pinned at
 * the top once picked. */
export function StageHook({
  session,
  vaultHooks,
  hasLlmKey,
  proxyDown,
  llmProxyUrl,
  initialVaultItemId,
  onHooksChange,
  onChosenHookChange,
  onRunRecorded,
}: {
  session: RemixSessionRow;
  vaultHooks: VaultItemRow[];
  hasLlmKey: boolean;
  // True when the run log's most recent attempt(s) look like the local model proxy
  // is unreachable (run-log-view.ts's isProxyLikelyDown) — distinct from !hasLlmKey,
  // which only means no key is configured at all. Both swap this stage for the same
  // designed block instead of a live generate button that's doomed to fail again.
  proxyDown: boolean;
  llmProxyUrl: string | null;
  // Preselects this Vault hook's Select option when arriving via a Vault template
  // card's "Use in Remix" deep link (?hook=<id>, review finding H2 — see deep-link.ts).
  initialVaultItemId?: string;
  onHooksChange: (hooks: string[]) => void;
  onChosenHookChange: (hook: string) => void;
  // Tells the studio to re-fetch the run log — every call below writes a row on
  // both success and failure (services/remix.ts's recordRun), so the log and the
  // proxy-down read stay live without a page reload.
  onRunRecorded: () => void;
}) {
  const [vaultItemId, setVaultItemId] = useState(initialVaultItemId ?? NONE_VALUE);
  const [generating, setGenerating] = useState(false);
  // Initialized once from the session prop (this component only mounts while the Hook
  // stage is active, so a fresh mount is exactly when `session.hookOptions` should be
  // picked up again); `generate()` below is the only thing that changes hookOptions
  // afterward, and it already calls setDrafts directly — no sync effect needed.
  const [drafts, setDrafts] = useState<string[]>(session.hookOptions ?? []);
  // Prefix for the per-option read-only fields below, so each label points at its own
  // textarea even with several StageHook-rendered grids alive in the tree.
  const hookFieldId = useId();

  async function generate(steer?: string) {
    setGenerating(true);
    const result = await generateHooksAction(session.id, vaultItemId === NONE_VALUE ? undefined : vaultItemId, steer);
    setGenerating(false);
    if (result.ok) {
      onHooksChange(result.hooks);
      setDrafts(result.hooks);
    } else {
      toast.error(result.error);
    }
    onRunRecorded();
  }

  async function saveAsTemplate(text: string) {
    const result = await createVaultItemAction({
      type: "hook",
      title: `Hook: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`,
      templateText: text,
      tags: [],
    });
    if (result.ok) toast.success("Saved to Vault");
    else toast.error(result.error);
  }

  function chooseHook(text: string) {
    onChosenHookChange(text);
    autosave(updateStageAction(session.id, { chosenHook: text }));
  }

  // DESIGN.md §6: an empty Vault never blocks the stage — generation still falls back
  // to the source video's own pattern — so the empty state is just a disabled option
  // explaining why there's nothing else to pick, not a dead end.
  const vaultOptions: { value: string; label: string; disabled?: boolean }[] = [
    { value: NONE_VALUE, label: "None — use source hook pattern" },
    ...(vaultHooks.length > 0
      ? vaultHooks.map((item) => ({ value: item.id, label: item.title }))
      : [{ value: EMPTY_VALUE, label: "No saved hooks yet", disabled: true }]),
  ];

  // 2026-08-15 spec part 7: names what actually fed the last/next hook generation,
  // read straight off session state already in this component — no server round trip.
  // The hook-pattern clause is gated on vaultItemId: when a Vault hook template is
  // picked, generateHooks (remix.ts) swaps the pattern to that template instead of
  // describeSourceHookPattern, so the source no longer fed the pattern (review
  // finding: misattribution when a vault template is selected).
  const hookAnalysis = session.researchNotes?.sourceAnalysis;
  const usingVaultHook = vaultItemId !== NONE_VALUE && vaultItemId !== EMPTY_VALUE;
  const vaultHookTitle = usingVaultHook ? vaultHooks.find((item) => item.id === vaultItemId)?.title : undefined;
  const groundedInParts = [
    hookAnalysis ? `why it worked` : null,
    usingVaultHook ? `hook pattern (Vault template${vaultHookTitle ? `: ${vaultHookTitle}` : ""})` : hookAnalysis ? `hook pattern (${hookAnalysis.hookType})` : null,
    hookAnalysis?.structureSegments[0]?.transcript ? "opening beat transcript" : null,
    session.topic ? "your topic" : null,
    session.niche ? "your niche" : null,
    session.researchNotes?.facts ? "your facts" : null,
  ].filter((part): part is string => Boolean(part));
  const groundedInText = groundedInParts.length > 0 ? groundedInParts.join(", ") : "nothing yet, fill in Prompt and Research first";

  // Generation is offline, not broken. This swaps the whole picker for the block —
  // the same posture as Style/Script — instead of graying out controls that can't do
  // anything anyway. Two distinct reasons (no key vs. proxy unreachable) share one
  // surface; see generation-blocked.tsx.
  if (!hasLlmKey || proxyDown) {
    return <GenerationBlocked reason={!hasLlmKey ? "no-key" : "proxy-down"} feature="Hook generation" proxyUrl={llmProxyUrl} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {session.chosenHook && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Chosen hook</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{session.chosenHook}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full sm:w-64">
          <FieldContent>
            <FieldLabel htmlFor="hook-vault-select">Seed from a Vault hook</FieldLabel>
          </FieldContent>
          <Select items={vaultOptions} value={vaultItemId} onValueChange={(v) => setVaultItemId(v as string)}>
            <SelectTrigger id="hook-vault-select" data-testid="remix-hook-seed-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vaultOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {/* Secondary, not primary: Continue in the footer is the one primary action on
            this screen, and generating hooks is a step on the way to it. */}
        <Button variant="secondary" onClick={() => generate()} disabled={generating}>
          {generating ? "Generating…" : drafts.length > 0 ? "Regenerate hooks" : "Generate hooks"}
        </Button>
      </div>

      <GroundedIn>{groundedInText}</GroundedIn>

      {generating ? (
        <GeneratingSkeleton label="Generating hooks…" count={5} rowClassName="h-28" layout="grid" />
      ) : drafts.length > 0 ? (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {drafts.map((hook, i) => {
            const isChosen = session.chosenHook === hook;
            return (
              <Card key={i} size="sm" className={cn(isChosen && "bg-primary/10 ring-2 ring-primary/30")}>
                <CardContent className="flex flex-col gap-3">
                  {/* Read-only presentation, not an editable field — edits here never
                      reached the server and were lost on reload (truth pass,
                      v1-gap-inventory.md). "Use this hook" is the only way to commit
                      a hook, so the control is disabled rather than merely unwired.
                      The opacity override is deliberate: the hook text is the card's
                      whole content, so it has to stay as legible as it was as a <p>. */}
                  <Field>
                    <FieldLabel htmlFor={`${hookFieldId}-${i}`} className="sr-only">
                      Hook option {i + 1}
                    </FieldLabel>
                    <Textarea id={`${hookFieldId}-${i}`} value={hook} disabled className="disabled:opacity-100" />
                  </Field>
                  <ButtonGroup>
                    <Button size="sm" variant="secondary" onClick={() => chooseHook(hook)}>
                      {isChosen ? (
                        <>
                          <Check className="size-3.5" /> Selected
                        </>
                      ) : (
                        "Use this hook"
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => saveAsTemplate(hook)}>
                      <Bookmark className="size-3.5" /> Save as template
                    </Button>
                  </ButtonGroup>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <SteerBox
          placeholder="e.g. punchier, lead with the number, less clickbait"
          pending={generating}
          onRegenerate={(note) => generate(note)}
        />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Generate hooks to get started.</p>
      )}
    </div>
  );
}
