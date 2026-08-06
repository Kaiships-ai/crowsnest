"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { GenerationBlocked } from "@/components/remix/generation-blocked";
import { deriveScriptTitle } from "@/lib/script-title";
import { buildVideoPromptAction } from "@/server/actions/export-actions";
import { createPlannedPostAction } from "@/server/actions/planned-post-actions";
import { generateVariantsAction, saveScriptAction, updateStageAction } from "@/server/actions/remix-actions";
import type { RemixSessionRow } from "@/server/services/remix";

type VariantResult = string | { error: string };

const DEFAULT_COUNT = 3;

function isError(result: VariantResult): result is { error: string } {
  return typeof result === "object";
}

/** DESIGN.md §2.5 stage ⑤ + §6: variant Tabs, editable Textareas, per-variant
 * regenerate + copy, a failed variant shows an inline destructive Alert + retry while
 * successes stay untouched, "Save script" -> title Dialog -> toast + link to Vault. */
export function StageScript({
  session,
  hasLlmKey,
  proxyDown,
  llmProxyUrl,
  onVariantsChange,
  onRunRecorded,
}: {
  session: RemixSessionRow;
  hasLlmKey: boolean;
  proxyDown: boolean;
  llmProxyUrl: string | null;
  onVariantsChange: (variants: string[]) => void;
  onRunRecorded: () => void;
}) {
  // Initialized once from the session prop — this component only mounts while the
  // Script stage is active, so a fresh mount is exactly when session.variants should
  // be picked up again; writeScript()/regenerate() below are the only things that
  // change it afterward, and both already call setResults directly — no sync effect
  // needed (see stage-hook.tsx / stage-style.tsx for the same reasoning).
  const [results, setResults] = useState<VariantResult[]>(session.variants ?? []);
  const [pending, setPending] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("0");
  const [saveOpen, setSaveOpen] = useState(false);
  // Derived, not the raw topic: the Prompt stage prefills session.topic with the whole
  // source caption, which used to land in scripts.title verbatim (rows of two thousand
  // characters). Still just a default — the Input below is editable.
  const [saveTitle, setSaveTitle] = useState(() => deriveScriptTitle(session.topic));
  const [saving, setSaving] = useState(false);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);
  // The Script stage's plan exit (v1-scope.md, Remix studio acceptance 7-9): offered
  // once a script exists, never required — the script above is already saved by the
  // time this appears, so declining the date here can't leave the run unfinishable.
  const [planDate, setPlanDate] = useState("");
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [addedPlanDate, setAddedPlanDate] = useState<string | null>(null);

  // Persists the *whole* array — used only for a manual variant-text edit
  // (commitEditBlur below), where there's no single server-known "slot" the way a
  // regenerate has. regenerate() below does NOT call this (see its comment, M2).
  function persistSuccesses(next: VariantResult[]) {
    const successes = next.filter((r): r is string => typeof r === "string");
    onVariantsChange(successes);
    autosave(updateStageAction(session.id, { variants: successes }));
  }

  async function writeScript() {
    setPending(true);
    const result = await generateVariantsAction(session.id, DEFAULT_COUNT);
    setPending(false);
    if (result.ok) {
      setResults(result.variants);
      setActiveTab("0");
    } else {
      toast.error(result.error);
    }
    onRunRecorded();
  }

  async function regenerate(index: number) {
    setRegeneratingIndex(index);
    const result = await generateVariantsAction(session.id, undefined, index);
    setRegeneratingIndex(null);
    onRunRecorded();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const next = [...results];
    next[index] = result.variants[0] ?? { error: "No result returned" };
    setResults(next);
    // Local sync only — the server already read-modify-wrote this one slot into
    // variants[] (remix.ts's generateVariants with `index` set, review finding M2),
    // so re-persisting the whole client-side `next` array here (the old "repair
    // hack") would risk clobbering a sibling slot's concurrent autosave with a stale
    // copy instead of the merge the server already did correctly.
    onVariantsChange(next.filter((r): r is string => typeof r === "string"));
  }

  function commitEdit(index: number, text: string) {
    const next = [...results];
    next[index] = text;
    setResults(next);
  }

  function commitEditBlur() {
    persistSuccesses(results);
  }

  // Clipboard writes can reject (denied permission, insecure context, etc.) — caught
  // explicitly in both functions below so a failure surfaces as a toast instead of a
  // silent unhandled rejection with no user feedback.
  async function copyVariant(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Script copied");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  /** DESIGN.md §2.5 stage ⑤: "same affordance as Video Detail" — Copy-as-Prompt is
   * scoped to the source video (services/export.ts's buildVideoPrompt), not the
   * in-progress draft variant text. */
  async function createPrompt() {
    const result = await buildVideoPromptAction(session.sourceVideoId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.prompt);
      toast.success("Prompt copied — paste into any LLM");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  async function saveScript() {
    const index = Number(activeTab);
    const content = results[index];
    if (typeof content !== "string") return;
    setSaving(true);
    const result = await saveScriptAction(session.id, content, saveTitle);
    setSaving(false);
    if (result.ok) {
      setSavedScriptId(result.scriptId);
      // A later save (a different variant, or the same one again) is a different
      // scripts row — any earlier "added to plan" confirmation was about the
      // previous one, so it can't carry over onto this save.
      setAddedPlanDate(null);
      setPlanDate("");
      setSaveOpen(false);
      toast.success("Script saved", {
        action: { label: "Open in Vault", onClick: () => window.open("/vault?tab=scripts", "_blank") },
      });
    } else {
      toast.error(result.error);
    }
  }

  /**
   * Carries the just-saved script into a new planned post (actions/planned-post-
   * actions.ts, landed 1dbb9b8) — the manual planner's load-bearing link, so a
   * finished cut can leave a remix session with a date attached rather than sitting
   * only in the Vault. `remixSessionId` is this session's id, matching what
   * `saveScript` already stamped on the script itself.
   */
  async function addToPlan() {
    if (!savedScriptId || !planDate) return;
    setAddingToPlan(true);
    const result = await createPlannedPostAction({
      title: saveTitle,
      plannedDate: planDate,
      scriptId: savedScriptId,
      remixSessionId: session.id,
      sourceVideoId: session.sourceVideoId,
    });
    setAddingToPlan(false);
    if (result.ok) {
      setAddedPlanDate(planDate);
      toast.success(`Added to your plan for ${planDate}`);
    } else {
      toast.error(result.error);
    }
  }

  // Script writing is offline, not broken — same block treatment as Hook/Style. This
  // is the last stage (no footer Continue), so its own CTA gets to be the one amber
  // action once the key comes back. Two distinct reasons share one surface — see
  // generation-blocked.tsx.
  if (!hasLlmKey || proxyDown) {
    return <GenerationBlocked reason={!hasLlmKey ? "no-key" : "proxy-down"} feature="Script writing" proxyUrl={llmProxyUrl} />;
  }

  if (results.length === 0 && !pending) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">Generate to see variants here.</p>
        <Button onClick={writeScript}>Write script</Button>
      </div>
    );
  }

  if (pending) {
    // generateVariantsAction is one atomic call with no incremental signal to
    // observe (truth pass, v1-gap-inventory.md) — the old version cycled fake
    // status lines like "Writing variant 2" on a timer, which is not knowable.
    // An honest indeterminate state doesn't claim to know what it doesn't.
    return (
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-wide text-faint uppercase">Writing script…</p>
        {Array.from({ length: DEFAULT_COUNT }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-none" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {results.map((_, i) => (
            <TabsTrigger key={i} value={String(i)}>
              Variant {i + 1}
            </TabsTrigger>
          ))}
        </TabsList>

        {results.map((result, i) => (
          <TabsContent key={i} value={String(i)} className="flex flex-col gap-3 pt-3">
            {isError(result) ? (
              <Alert variant="destructive" className="rounded-none">
                <AlertTitle>Couldn&rsquo;t generate this variant</AlertTitle>
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            ) : (
              <Textarea
                value={result}
                onChange={(e) => commitEdit(i, e.target.value)}
                onBlur={commitEditBlur}
                rows={12}
                className="font-mono text-sm"
              />
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => regenerate(i)} disabled={regeneratingIndex === i}>
                <RefreshCw className={regeneratingIndex === i ? "size-3.5 animate-spin" : "size-3.5"} />
                {isError(result) ? "Retry" : "Regenerate"}
              </Button>
              {!isError(result) && (
                <Button size="sm" variant="ghost" onClick={() => copyVariant(result)}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={writeScript}>
          Regenerate all
        </Button>
        <Button variant="outline" onClick={createPrompt}>
          <Wand2 className="size-3.5" /> Create Prompt
        </Button>
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogTrigger render={<Button disabled={typeof results[Number(activeTab)] !== "string"} />}>Save script</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save script</DialogTitle>
              <DialogDescription>Saves the currently-open variant to your scripts.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="script-title">Title</Label>
              <Input id="script-title" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={saveScript} disabled={saving || !saveTitle}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {savedScriptId && (
          <Link href="/vault?tab=scripts" className="text-xs text-muted-foreground hover:text-foreground">
            View in Vault →
          </Link>
        )}
      </div>

      {savedScriptId && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Add to plan</Label>
          {addedPlanDate ? (
            <p className="text-sm text-muted-foreground">
              On the plan for <span className="text-foreground">{addedPlanDate}</span>.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="script-plan-date" className="text-xs text-muted-foreground">
                    Date
                  </Label>
                  <Input id="script-plan-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="w-44" />
                </div>
                <Button onClick={addToPlan} disabled={!planDate || addingToPlan}>
                  {addingToPlan ? "Adding…" : "Add to plan"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Optional — the script above is already saved either way. Skip this and it just stays in the Vault.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
