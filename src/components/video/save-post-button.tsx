"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSavedPostAction, deleteSavedPostAction } from "@/server/actions/saved-post-actions";

/**
 * Saves the post itself, which is a different thing from `SaveToVaultDialog` next to it.
 * That one lifts a hook or a layout out of the analysis into `vault_items` as a reusable
 * template. This one keeps the post, in `saved_posts`, with a note saying why it was
 * worth keeping. Both are called saving and they are deliberately not one button: one
 * produces a template you write from, the other produces a shortlist you come back to.
 *
 * Until this existed the Vault's saved-posts list had no way to be filled at all.
 */
export function SavePostButton({
  videoId,
  saved,
}: {
  videoId: string;
  /** The row if this post is already kept, so the button reads its state without a fetch. */
  saved: { id: string; note: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function keep() {
    startTransition(async () => {
      const result = await createSavedPostAction({ videoId, note: note.trim() || undefined });
      if (result.ok) {
        toast.success("Kept in the vault");
        setOpen(false);
        setNote("");
      } else {
        toast.error(result.error);
      }
    });
  }

  function forget() {
    if (!saved) return;
    startTransition(async () => {
      const result = await deleteSavedPostAction(saved.id);
      if (result.ok) toast.success("Removed from the vault");
      else toast.error(result.error);
    });
  }

  if (saved) {
    return (
      <Button variant="outline" size="sm" onClick={forget} disabled={pending}>
        <BookmarkCheck className="size-3.5" /> Kept
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Bookmark className="size-3.5" /> Keep this post
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keep this post</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="saved-post-note">Why it is worth keeping</Label>
          <Textarea
            id="saved-post-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The hook lands before the first cut"
            rows={3}
          />
          {/* Optional on purpose. A required field here would get filled with anything
              to get past it, and a note that says nothing is worse than no note. */}
          <p className="text-2xs text-faint">Optional. The vault shows this next to the score.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={keep} disabled={pending}>
            {pending ? "Keeping" : "Keep"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
