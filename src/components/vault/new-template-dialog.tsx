"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createVaultItemAction } from "@/server/actions/vault-actions";

const TYPE_ITEMS = [
  { value: "hook", label: "Hook" },
  { value: "style", label: "Style" },
];

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** DESIGN.md §2.6's secondary path into the Vault: typing a template in from scratch
 * (vs. saving one from an analyzed video's Save-to-Vault flow, or a Remix stage). */
export function NewTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"hook" | "style">("hook");
  const [title, setTitle] = useState("");
  const [templateText, setTemplateText] = useState("");
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);

  function reset() {
    setType("hook");
    setTitle("");
    setTemplateText("");
    setTags("");
    setPending(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function submit() {
    setPending(true);
    const result = await createVaultItemAction({ type, title, templateText, tags: parseTags(tags) });
    setPending(false);
    if (result.ok) {
      toast.success("Template saved to Vault");
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>+ New template</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>Add a hook or style template by hand.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-type">Type</Label>
            <Select items={TYPE_ITEMS} value={type} onValueChange={(v) => setType(v as "hook" | "style")}>
              <SelectTrigger id="template-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-title">Title</Label>
            <Input id="template-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Curiosity Gap Hook" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-text">Template text</Label>
            <Textarea
              id="template-text"
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              placeholder="the {topic} nobody is talking about (yet)"
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-tags">Tags (comma separated)</Label>
            <Input id="template-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="curiosity, warning" />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!title || !templateText || pending}>
            {pending ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
