"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type AgentStage = "hook" | "style" | "script";

const STAGE_STEPS: Record<AgentStage, string> = {
  hook: "Call crowsnest_remix_hooks with that sessionId to get the hook prompt, write 5 hooks by fulfilling it, then call crowsnest_remix_choose_hook with your best one.",
  style:
    "Call crowsnest_remix_outline with that sessionId and no outline to get the outline prompt, write the beat outline by fulfilling it, then call crowsnest_remix_outline again with your outline to save it.",
  script:
    "Call crowsnest_remix_variants with that sessionId to get the script prompt, write the script by fulfilling it, then call crowsnest_remix_save_script with a title and your script.",
};

const STAGE_LABEL: Record<AgentStage, string> = { hook: "Hook", style: "Style (outline)", script: "Script" };

export function buildClaudePrompt(stage: AgentStage, videoId: string, vaultItemId?: string): string {
  const seed = stage === "hook" && vaultItemId ? ` Pass vaultItemId "${vaultItemId}" to crowsnest_remix_hooks.` : "";
  return [
    `Remix source video ${videoId} in crowsnest, ${STAGE_LABEL[stage]} stage.`,
    `Call crowsnest_remix_session with videoId "${videoId}" to get the sessionId.`,
    STAGE_STEPS[stage] + seed,
  ].join(" ");
}

export function CopyPromptButton({ stage, videoId, vaultItemId }: { stage: AgentStage; videoId: string; vaultItemId?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildClaudePrompt(stage, videoId, vaultItemId));
      toast.success("Prompt copied. Paste it into Claude, then reload this page.");
    } catch {
      toast.error("Couldn't copy to clipboard, check browser permissions.");
    }
  }

  return (
    <Button variant="secondary" onClick={copy} data-testid={`remix-copy-prompt-${stage}`}>
      <Copy className="size-3.5" /> Copy prompt for Claude
    </Button>
  );
}
