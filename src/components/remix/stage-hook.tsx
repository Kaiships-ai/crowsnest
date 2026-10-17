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
import { CopyPromptButton } from "@/components/remix/copy-prompt-button";
import { GroundedIn } from "@/components/remix/grounded-in";
import { cn } from "@/lib/utils";
import { updateStageAction } from "@/server/actions/remix-actions";
import { createVaultItemAction } from "@/server/actions/vault-actions";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const NONE_VALUE = "__none__";
const EMPTY_VALUE = "__empty__";

export function StageHook({
  session,
  vaultHooks,
  initialVaultItemId,
  onChosenHookChange,
}: {
  session: RemixSessionRow;
  vaultHooks: VaultItemRow[];
  // Preselects this Vault hook's Select option when arriving via a Vault template
  // card's "Use in Remix" deep link (?hook=<id>, review finding H2 — see deep-link.ts).
  initialVaultItemId?: string;
  onChosenHookChange: (hook: string) => void;
}) {
  const [vaultItemId, setVaultItemId] = useState(initialVaultItemId ?? NONE_VALUE);
  const hooks = session.hookOptions ?? [];
  const hookFieldId = useId();
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

  // DESIGN.md §6: an empty Vault never blocks the stage, the prompt falls back
  // to the source video's own pattern — so the empty state is just a disabled option
  // explaining why there's nothing else to pick, not a dead end.
  const vaultOptions: { value: string; label: string; disabled?: boolean }[] = [
    { value: NONE_VALUE, label: "None — use source hook pattern" },
    ...(vaultHooks.length > 0
      ? vaultHooks.map((item) => ({ value: item.id, label: item.title }))
      : [{ value: EMPTY_VALUE, label: "No saved hooks yet", disabled: true }]),
  ];

  // 2026-08-15 spec part 7: names what feeds the hook prompt,
  // read straight off session state already in this component — no server round trip.
  // The hook-pattern clause is gated on vaultItemId: when a Vault hook template is
  // picked, buildHookPrompt (remix.ts) swaps the pattern to that template instead of
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
        <CopyPromptButton stage="hook" videoId={session.sourceVideoId} vaultItemId={usingVaultHook ? vaultItemId : undefined} />
      </div>

      <GroundedIn>{groundedInText}</GroundedIn>

      {hooks.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {hooks.map((hook, i) => {
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
      ) : session.chosenHook ? null : (
        <p className="text-sm text-muted-foreground">No hooks yet. Copy the prompt into Claude, then reload to see what it wrote.</p>
      )}
    </div>
  );
}
