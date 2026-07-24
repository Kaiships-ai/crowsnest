"use client";

import Link from "next/link";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildScriptPromptAction } from "@/server/actions/export-actions";
import type { ScriptRow } from "@/server/queries/vault";

function firstLine(content: string): string {
  return content.split("\n")[0] ?? "";
}

/** Vault Scripts tab (Task 7): per-script Copy-as-Prompt, reading the saved script's
 * own hook/style Vault links + source video (services/export.ts's buildScriptPrompt) —
 * distinct from the Remix Studio Script stage's "same as Video Detail" affordance,
 * since a saved script has real ids to build from. */
export function ScriptCard({ script }: { script: ScriptRow }) {
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
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium">{script.title}</h3>
          <Badge variant={script.status === "final" ? "default" : "outline"}>{script.status}</Badge>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{firstLine(script.content)}</p>
        {(script.hookTitle || script.styleTitle) && (
          <div className="flex flex-wrap gap-1">
            {script.hookTitle && <Badge variant="secondary">{script.hookTitle}</Badge>}
            {script.styleTitle && <Badge variant="secondary">{script.styleTitle}</Badge>}
          </div>
        )}
        {script.sourceVideo && (
          <Link href={`/feed/${script.sourceVideo.videoId}`} className="w-fit text-xs text-muted-foreground hover:text-foreground">
            {script.sourceVideo.channelHandle}
          </Link>
        )}
        <Button size="sm" variant="outline" onClick={createPrompt} className="w-fit">
          <Wand2 className="size-3.5" /> Create Prompt
        </Button>
      </CardContent>
    </Card>
  );
}
