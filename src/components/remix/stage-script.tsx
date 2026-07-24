"use client";

import { useEffect, useState } from "react";
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
import { buildVideoPromptAction } from "@/server/actions/export-actions";
import { generateVariantsAction, saveScriptAction, updateStageAction } from "@/server/actions/remix-actions";
import type { RemixSessionRow } from "@/server/services/remix";

type VariantResult = string | { error: string };

const DEFAULT_COUNT = 3;
const PROGRESS_MESSAGES = ["Researching pacing…", "Writing variant 1…", "Writing variant 2…", "Writing variant 3…", "Polishing…"];

function isError(result: VariantResult): result is { error: string } {
  return typeof result === "object";
}

/** DESIGN.md §2.5 stage ⑤ + §6: variant Tabs, editable Textareas, per-variant
 * regenerate + copy, a failed variant shows an inline destructive Alert + retry while
 * successes stay untouched, "Save script" -> title Dialog -> toast + link to Vault. */
export function StageScript({
  session,
  hasLlmKey,
  onVariantsChange,
}: {
  session: RemixSessionRow;
  hasLlmKey: boolean;
  onVariantsChange: (variants: string[]) => void;
}) {
  // Initialized once from the session prop — this component only mounts while the
  // Script stage is active, so a fresh mount is exactly when session.variants should
  // be picked up again; writeScript()/regenerate() below are the only things that
  // change it afterward, and both already call setResults directly — no sync effect
  // needed (see stage-hook.tsx / stage-style.tsx for the same reasoning).
  const [results, setResults] = useState<VariantResult[]>(session.variants ?? []);
  const [pending, setPending] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("0");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(session.topic ?? "Untitled script");
  const [saving, setSaving] = useState(false);
  const [savedScriptId, setSavedScriptId] = useState<string | null>(null);

  // Simulated per-stage progress (DESIGN.md §6's "Writing variant 2 of 3…") — Task 5's
  // generateVariants is one atomic Promise.allSettled call with no incremental signal
  // to observe, so this cycles a status line on a timer while the call is in flight
  // rather than tracking real completion.
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [pending]);

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
    setProgressIndex(0);
    const result = await generateVariantsAction(session.id, DEFAULT_COUNT);
    setPending(false);
    if (result.ok) {
      setResults(result.variants);
      setActiveTab("0");
    } else {
      toast.error(result.error);
    }
  }

  async function regenerate(index: number) {
    setRegeneratingIndex(index);
    const result = await generateVariantsAction(session.id, undefined, index);
    setRegeneratingIndex(null);
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
      setSaveOpen(false);
      toast.success("Script saved", {
        action: { label: "Open in Vault", onClick: () => window.open("/vault?tab=scripts", "_blank") },
      });
    } else {
      toast.error(result.error);
    }
  }

  if (results.length === 0 && !pending) {
    return (
      <div className="flex flex-col items-start gap-3">
        {!hasLlmKey && (
          <Alert>
            <AlertTitle>Add your Claude API key</AlertTitle>
            <AlertDescription>Add ANTHROPIC_API_KEY in Settings to write scripts.</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">Generate to see variants here.</p>
        <Button onClick={writeScript} disabled={!hasLlmKey}>
          Write script
        </Button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{PROGRESS_MESSAGES[progressIndex]}</p>
        {Array.from({ length: DEFAULT_COUNT }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
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
              <Alert variant="destructive">
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
              <Button size="sm" variant="outline" onClick={() => regenerate(i)} disabled={!hasLlmKey || regeneratingIndex === i}>
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
        <Button variant="outline" onClick={writeScript} disabled={!hasLlmKey}>
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
    </div>
  );
}
