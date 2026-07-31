"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createVaultItemAction } from "@/server/actions/vault-actions";
import type { VideoAnalysis } from "@/server/llm/schemas";

type Choice = "hook" | "style" | "both";

function titleCaseSlug(slug: string): string {
  if (!slug) return "Untitled";
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** DESIGN.md §2.4/§2.6: prefilled from the video's analysis, editable before save. */
function suggestHook(analysis: VideoAnalysis) {
  const firstNote = analysis.structureSegments[0]?.note;
  return {
    title: `${titleCaseSlug(analysis.hookType)} Hook`,
    templateText: firstNote ? `${firstNote} — for {topic}` : `A ${analysis.hookType || "curiosity"} hook about {topic}`,
    tags: analysis.hookType ? [analysis.hookType] : [],
  };
}

function suggestStyle(analysis: VideoAnalysis) {
  const labels = analysis.structureSegments.map((segment) => segment.label);
  const summary = [labels.length > 0 ? labels.join(" → ") : null, analysis.styleTags.length > 0 ? analysis.styleTags.join(", ") : null]
    .filter(Boolean)
    .join(" — ");
  return {
    title: labels.length > 0 ? `${labels.join("-")} Style` : "Style Template",
    templateText: summary || "Describe the structure and editing style.",
    tags: analysis.styleTags,
  };
}

export function SaveToVaultDialog({ videoId, analysis }: { videoId: string; analysis: VideoAnalysis }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("hook");
  const [pending, setPending] = useState(false);

  const hookSuggestion = suggestHook(analysis);
  const styleSuggestion = suggestStyle(analysis);
  const [hookTitle, setHookTitle] = useState(hookSuggestion.title);
  const [hookText, setHookText] = useState(hookSuggestion.templateText);
  const [hookTags, setHookTags] = useState(hookSuggestion.tags.join(", "));
  const [styleTitle, setStyleTitle] = useState(styleSuggestion.title);
  const [styleText, setStyleText] = useState(styleSuggestion.templateText);
  const [styleTags, setStyleTags] = useState(styleSuggestion.tags.join(", "));

  function parseTags(value: string): string[] {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  async function save() {
    setPending(true);
    const results = await Promise.all([
      choice !== "style"
        ? createVaultItemAction({ type: "hook", title: hookTitle, templateText: hookText, tags: parseTags(hookTags), sourceVideoId: videoId })
        : null,
      choice !== "hook"
        ? createVaultItemAction({ type: "style", title: styleTitle, templateText: styleText, tags: parseTags(styleTags), sourceVideoId: videoId })
        : null,
    ]);
    setPending(false);

    const failure = results.find((result) => result && !result.ok);
    if (failure && !failure.ok) {
      toast.error(failure.error);
      return;
    }
    toast.success(choice === "both" ? "Saved hook and style to Vault" : `Saved ${choice} to Vault`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Bookmark className="size-3.5" /> Save to Vault
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to Vault</DialogTitle>
          <DialogDescription>Prefilled from this video&rsquo;s analysis — edit before saving.</DialogDescription>
        </DialogHeader>

        <ToggleGroup
          value={[choice]}
          onValueChange={(values) => {
            const next = values[0] as Choice | undefined;
            if (next) setChoice(next);
          }}
          aria-label="Save as"
        >
          <ToggleGroupItem value="hook" size="sm">
            Hook
          </ToggleGroupItem>
          <ToggleGroupItem value="style" size="sm">
            Style
          </ToggleGroupItem>
          <ToggleGroupItem value="both" size="sm">
            Both
          </ToggleGroupItem>
        </ToggleGroup>

        {(choice === "hook" || choice === "both") && (
          <div className="flex flex-col gap-2 border border-border p-3">
            <Label htmlFor="hook-title">Hook title</Label>
            <Input id="hook-title" value={hookTitle} onChange={(e) => setHookTitle(e.target.value)} />
            <Label htmlFor="hook-text">Hook template</Label>
            <Textarea id="hook-text" value={hookText} onChange={(e) => setHookText(e.target.value)} rows={3} />
            <Label htmlFor="hook-tags">Tags (comma separated)</Label>
            <Input id="hook-tags" value={hookTags} onChange={(e) => setHookTags(e.target.value)} />
          </div>
        )}

        {(choice === "style" || choice === "both") && (
          <div className="flex flex-col gap-2 border border-border p-3">
            <Label htmlFor="style-title">Style title</Label>
            <Input id="style-title" value={styleTitle} onChange={(e) => setStyleTitle(e.target.value)} />
            <Label htmlFor="style-text">Style template</Label>
            <Textarea id="style-text" value={styleText} onChange={(e) => setStyleText(e.target.value)} rows={3} />
            <Label htmlFor="style-tags">Tags (comma separated)</Label>
            <Input id="style-tags" value={styleTags} onChange={(e) => setStyleTags(e.target.value)} />
          </div>
        )}

        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
