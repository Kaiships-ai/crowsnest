"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildScriptPromptAction } from "@/server/actions/export-actions";
import { deleteScriptAction } from "@/server/actions/remix-actions";
import type { ScriptRow } from "@/server/queries/vault";

type CarryingPlan = { id: string; title: string; plannedDate: string | null };

/** Full detail for a saved script (Vault Scripts tab), opened from the compact
 * ScriptCard. Carries the Create Prompt action (services/export.ts's
 * buildScriptPrompt, via buildScriptPromptAction) that used to live on the card face. */
export function ScriptDetailDialog({
  script,
  open,
  onOpenChange,
}: {
  script: ScriptRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Set when the delete was refused because planned posts still carry this script
  // (deleteScriptAction's SCRIPT_CARRIED_BY_PLAN). Shown in the confirm dialog rather
  // than a toast: the user has to go and do something about each plan, and a toast
  // that names them is gone before it can be read.
  const [carryingPlans, setCarryingPlans] = useState<CarryingPlan[]>([]);

  // Swap the detail dialog for the confirm one rather than stacking both open at once,
  // so there is only ever one backdrop on screen (matches TemplateDetailDialog).
  function openConfirm() {
    setCarryingPlans([]);
    onOpenChange(false);
    setConfirmOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteScriptAction(script.id);
    setDeleting(false);
    if (result.ok) {
      setConfirmOpen(false);
      toast.success("Script deleted");
      router.refresh();
      return;
    }
    if (result.code === "SCRIPT_CARRIED_BY_PLAN") {
      // The dialog stays open carrying the reason. Nothing was deleted.
      setCarryingPlans(result.plans ?? []);
      return;
    }
    setConfirmOpen(false);
    toast.error(result.error);
  }

  // Clipboard writes can reject (denied permission, insecure context, etc.) — caught
  // explicitly so a failure surfaces as a toast instead of a silent unhandled
  // rejection with no user feedback.
  async function createPrompt() {
    const result = await buildScriptPromptAction(script.id);
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* flex column with a capped height: the header and footer stay pinned and the
            middle scrolls. A saved script can run to many hundreds of lines, which without
            a cap overflowed the whole viewport past the top and bottom of the dialog. */}
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2 pr-6">
              {/* script.title can hold the entire body (a generator data smell), so clamp
                  it to one line rather than repeating the wall the scroll region shows. */}
              <DialogTitle className="line-clamp-1">{script.title}</DialogTitle>
              <Badge variant={script.status === "final" ? "secondary" : "outline"}>{script.status}</Badge>
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {(script.hookTitle || script.styleTitle) && (
              <div className="flex flex-wrap gap-1">
                {script.hookTitle && <Badge variant="secondary">{script.hookTitle}</Badge>}
                {script.styleTitle && <Badge variant="secondary">{script.styleTitle}</Badge>}
              </div>
            )}

            <p className="whitespace-pre-wrap text-sm text-foreground">
              {script.content}
            </p>

            {script.sourceVideo && (
              <Link
                href={`/feed/${script.sourceVideo.videoId}`}
                className="w-fit text-xs text-muted-foreground hover:text-foreground"
              >
                {script.sourceVideo.channelHandle}
              </Link>
            )}
          </div>

          <DialogFooter className="justify-between sm:justify-between">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={openConfirm}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
            <Button size="sm" variant="outline" onClick={createPrompt} className="w-fit">
              <Wand2 className="size-3.5" /> Create Prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            {/* Clamped for the same reason the detail title is: a script saved before
                the generator started deriving a short title can hold its whole body
                here. */}
            <DialogTitle className="line-clamp-2">Delete &ldquo;{script.title}&rdquo;?</DialogTitle>
            <DialogDescription>This can&rsquo;t be undone.</DialogDescription>
          </DialogHeader>

          {carryingPlans.length > 0 && (
            <div className="flex flex-col gap-2 border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">
                Still carried by {carryingPlans.length === 1 ? "a planned post" : `${carryingPlans.length} planned posts`}.
                Detach it from each plan first, or delete the plans too.
              </p>
              <ul className="flex flex-col gap-1">
                {carryingPlans.map((plan) => (
                  <li key={plan.id} className="font-mono text-2xs text-muted-foreground">
                    {plan.title}
                    {plan.plannedDate ? ` · ${plan.plannedDate}` : ""}
                  </li>
                ))}
              </ul>
              <Link href="/?tab=calendar" className="w-fit font-mono text-2xs text-muted-foreground hover:text-foreground">
                Open the planner
              </Link>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || carryingPlans.length > 0}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
