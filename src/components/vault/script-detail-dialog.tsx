"use client";

import Link from "next/link";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildScriptPromptAction } from "@/server/actions/export-actions";
import type { ScriptRow } from "@/server/queries/vault";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <DialogTitle>{script.title}</DialogTitle>
            <Badge variant={script.status === "final" ? "secondary" : "outline"}>{script.status}</Badge>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {(script.hookTitle || script.styleTitle) && (
            <div className="flex flex-wrap gap-1">
              {script.hookTitle && <Badge variant="secondary">{script.hookTitle}</Badge>}
              {script.styleTitle && <Badge variant="secondary">{script.styleTitle}</Badge>}
            </div>
          )}

          <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
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

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={createPrompt} className="w-fit">
            <Wand2 className="size-3.5" /> Create Prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
