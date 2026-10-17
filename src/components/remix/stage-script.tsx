"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { CopyPromptButton } from "@/components/remix/copy-prompt-button";
import { GroundedIn } from "@/components/remix/grounded-in";
import { deriveScriptTitle } from "@/lib/script-title";
import { buildRemixPromptAction } from "@/server/actions/export-actions";
import { createPlannedPostAction } from "@/server/actions/planned-post-actions";
import { editVariantAction, saveScriptAction, updateStageAction } from "@/server/actions/remix-actions";
import type { RemixSessionRow } from "@/server/services/remix";

export function StageScript({
  session,
  onVariantsChange,
  onChosenVariantChange,
}: {
  session: RemixSessionRow;
  onVariantsChange: (variants: string[]) => void;
  onChosenVariantChange: (index: number | null) => void;
}) {
  // Initialized once from the session prop — this component only mounts while the
  // Script stage is active, so a fresh mount is exactly when session.variants should
  // be picked up again; commitEdit() below is the only thing that changes it afterward.
  const [results, setResults] = useState<string[]>(session.variants ?? []);
  // Opens on the variant the session already records as chosen, so coming back to this
  // stage does not silently move the pick to variant 1.
  const [activeTab, setActiveTab] = useState(String(session.chosenVariantIndex ?? 0));
  const [saveOpen, setSaveOpen] = useState(false);
  // Derived, not the raw topic: the Prompt stage prefills session.topic with the whole
  // source caption, which used to land in scripts.title verbatim (rows of two thousand
  // characters). Still just a default — the Input below is editable.
  const [saveTitle, setSaveTitle] = useState(() => deriveScriptTitle(session.topic));
  const [saving, setSaving] = useState(false);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);
  const [savedVariantIndex, setSavedVariantIndex] = useState<number | null>(null);
  // The Script stage's plan exit (v1-scope.md, Remix studio acceptance 7-9): offered
  // once a script exists, never required — the script above is already saved by the
  // time this appears, so declining the date here can't leave the run unfinishable.
  const [planDate, setPlanDate] = useState("");
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [addedPlanDate, setAddedPlanDate] = useState<string | null>(null);

  /** Opening a variant tab IS the pick, persisted immediately so the Finish view and the
   *  post brief read the variant in front of the user rather than variants[0]. Saving
   *  re-records the same index server-side (see saveScript), which keeps a save without
   *  a tab change honest too. */
  function selectVariant(value: string) {
    setActiveTab(value);
    const index = Number(value);
    if (!Number.isInteger(index) || index === session.chosenVariantIndex) return;
    onChosenVariantChange(index);
    autosave(updateStageAction(session.id, { chosenVariantIndex: index }));
    // "Add to plan" attaches whatever savedScriptId points at — picking a different
    // variant than the one that was saved would let it attach text the user is no
    // longer looking at under a pick they didn't make. Hiding it until they save the
    // newly-picked variant keeps the same invariant finishRemix enforces server-side.
    if (savedVariantIndex !== null && index !== savedVariantIndex) {
      setSavedScriptId(null);
      setSavedVariantIndex(null);
      setAddedPlanDate(null);
      setPlanDate("");
    }
  }

  function commitEdit(index: number, text: string) {
    const next = [...results];
    next[index] = text;
    setResults(next);
  }

  function commitEditBlur(index: number) {
    if (results[index] === (session.variants ?? [])[index]) return;
    const edited = results;
    void autosave(editVariantAction(session.id, index, edited[index])).then((saved) => {
      if (saved) onVariantsChange(edited);
    });
    if (index === savedVariantIndex) {
      setSavedScriptId(null);
      setSavedVariantIndex(null);
      setAddedPlanDate(null);
      setPlanDate("");
    }
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

  /** Scoped to the remix SESSION (services/export.ts's buildRemixPrompt), not to the
   * source video. The source-scoped `buildVideoPrompt` is still what the video detail
   * screen's Copy-as-Prompt uses, and it is correct there; here it was wrong, because it
   * described the outlier and knew nothing about the hook or the variant the user had
   * just chosen. */
  async function createPrompt() {
    const result = await buildRemixPromptAction(session.id);
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
    if (content === undefined) return;
    setSaving(true);
    const result = await saveScriptAction(session.id, content, saveTitle, index);
    setSaving(false);
    if (result.ok) {
      setSavedScriptId(result.scriptId);
      setSavedVariantIndex(index);
      onChosenVariantChange(index);
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

  // 2026-08-15 spec part 7: names what feeds the script prompt, read
  // straight off session state already in this component — no server round trip.
  const scriptAnalysis = session.researchNotes?.sourceAnalysis;
  const groundedInParts = [
    scriptAnalysis ? "structure beats (note + transcript)" : null,
    scriptAnalysis ? "why it worked" : null,
    session.chosenHook ? "chosen hook" : null,
    session.researchNotes?.facts ? "your facts" : null,
  ].filter((part): part is string => Boolean(part));
  const groundedInText = groundedInParts.length > 0 ? groundedInParts.join(", ") : "nothing yet, fill in Prompt and Research first";

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <GroundedIn>{groundedInText}</GroundedIn>
        <CopyPromptButton stage="script" videoId={session.sourceVideoId} />
        <p className="text-sm text-muted-foreground">No script yet. Copy the prompt into Claude, then reload to see what it wrote.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GroundedIn>{groundedInText}</GroundedIn>
      <CopyPromptButton stage="script" videoId={session.sourceVideoId} />

      <Tabs value={activeTab} onValueChange={selectVariant}>
        <TabsList>
          {results.map((_, i) => (
            <TabsTrigger key={i} value={String(i)}>
              Variant {i + 1}
            </TabsTrigger>
          ))}
        </TabsList>

        {results.map((result, i) => (
          <TabsContent key={i} value={String(i)} className="flex flex-col gap-3 pt-3">
            <Textarea
              value={result}
              onChange={(e) => commitEdit(i, e.target.value)}
              onBlur={() => commitEditBlur(i)}
              rows={12}
              className="font-mono text-sm"
            />
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => copyVariant(result)}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </TabsContent>
        ))}
      </Tabs>

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup>
          <Button variant="outline" onClick={createPrompt}>
            <Wand2 className="size-3.5" /> Create Prompt
          </Button>
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger render={<Button disabled={results[Number(activeTab)] === undefined} />}>Save script</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save script</DialogTitle>
                <DialogDescription>Saves the currently-open variant to your scripts.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="script-title">Title</FieldLabel>
                <Input id="script-title" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
              </Field>
              <DialogFooter>
                <Button onClick={saveScript} disabled={saving || !saveTitle}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </ButtonGroup>
        {savedScriptId && (
          <Link href="/vault?tab=scripts" className="text-xs text-muted-foreground hover:text-foreground">
            View in Vault →
          </Link>
        )}
      </div>

      {savedScriptId && (
        <>
          <Separator />
          <FieldSet>
            <FieldLegend variant="label">Add to plan</FieldLegend>
            {addedPlanDate ? (
              <p className="text-sm text-muted-foreground">
                On the plan for <span className="text-foreground">{addedPlanDate}</span>.
              </p>
            ) : (
              <FieldGroup>
                <div className="flex flex-wrap items-end gap-3">
                  <Field className="w-44">
                    <FieldLabel htmlFor="script-plan-date">Date</FieldLabel>
                    <Input id="script-plan-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
                  </Field>
                  <Button onClick={addToPlan} disabled={!planDate || addingToPlan}>
                    {addingToPlan ? "Adding…" : "Add to plan"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional — the script above is already saved either way. Skip this and it just stays in the Vault.
                </p>
              </FieldGroup>
            )}
          </FieldSet>
        </>
      )}
    </div>
  );
}
