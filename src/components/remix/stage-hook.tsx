"use client";

import { useState } from "react";
import { Bookmark, Check } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { generateHooksAction, updateStageAction } from "@/server/actions/remix-actions";
import { createVaultItemAction } from "@/server/actions/vault-actions";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";

const NONE_VALUE = "__none__";
const EMPTY_VALUE = "__empty__";

/** DESIGN.md §2.5 stage ③: optional Vault-hook seed, "Generate 5 hooks" -> 5 editable
 * option Cards each with use/save-to-Vault actions; the chosen hook stays pinned at
 * the top once picked. */
export function StageHook({
  session,
  vaultHooks,
  hasLlmKey,
  initialVaultItemId,
  onHooksChange,
  onChosenHookChange,
}: {
  session: RemixSessionRow;
  vaultHooks: VaultItemRow[];
  hasLlmKey: boolean;
  // Preselects this Vault hook's Select option when arriving via a Vault template
  // card's "Use in Remix" deep link (?hook=<id>, review finding H2 — see deep-link.ts).
  initialVaultItemId?: string;
  onHooksChange: (hooks: string[]) => void;
  onChosenHookChange: (hook: string) => void;
}) {
  const [vaultItemId, setVaultItemId] = useState(initialVaultItemId ?? NONE_VALUE);
  const [generating, setGenerating] = useState(false);
  // Initialized once from the session prop (this component only mounts while the Hook
  // stage is active, so a fresh mount is exactly when `session.hookOptions` should be
  // picked up again); `generate()` below is the only thing that changes hookOptions
  // afterward, and it already calls setDrafts directly — no sync effect needed.
  const [drafts, setDrafts] = useState<string[]>(session.hookOptions ?? []);

  async function generate() {
    setGenerating(true);
    const result = await generateHooksAction(session.id, vaultItemId === NONE_VALUE ? undefined : vaultItemId);
    setGenerating(false);
    if (result.ok) {
      onHooksChange(result.hooks);
      setDrafts(result.hooks);
    } else {
      toast.error(result.error);
    }
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

  return (
    <div className="flex flex-col gap-6">
      {session.chosenHook && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">Chosen hook</p>
          <p className="text-sm">{session.chosenHook}</p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hook-vault-select">Seed from a Vault hook</Label>
          <Select items={vaultOptions} value={vaultItemId} onValueChange={(v) => setVaultItemId(v as string)}>
            <SelectTrigger id="hook-vault-select" className="w-64">
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
        </div>
        <Button onClick={generate} disabled={!hasLlmKey || generating}>
          {generating ? "Generating…" : drafts.length > 0 ? "Regenerate 5 hooks" : "Generate 5 hooks"}
        </Button>
      </div>

      {!hasLlmKey && (
        <Alert>
          <AlertTitle>Add your Claude API key</AlertTitle>
          <AlertDescription>Add ANTHROPIC_API_KEY in Settings to generate hooks.</AlertDescription>
        </Alert>
      )}

      {generating ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : drafts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {drafts.map((hook, i) => {
            const isChosen = session.chosenHook === hook;
            return (
              <Card key={i} className={isChosen ? "ring-2 ring-primary" : undefined}>
                <CardContent className="flex flex-col gap-2">
                  <Textarea
                    value={hook}
                    onChange={(e) => {
                      const next = [...drafts];
                      next[i] = e.target.value;
                      setDrafts(next);
                      onHooksChange(next);
                    }}
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={isChosen ? "default" : "secondary"} onClick={() => chooseHook(hook)}>
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Generate 5 hooks to get started.</p>
      )}
    </div>
  );
}
