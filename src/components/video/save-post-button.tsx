"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { createSavedPostAction, deleteSavedPostAction } from "@/server/actions/saved-post-actions";

/**
 * Saves the post itself, which is a different thing from `SaveToVaultDialog` next to it.
 * That one lifts a hook or a layout out of the analysis into `vault_items` as a reusable
 * template. This one keeps the post, in `saved_posts`, with a note saying why it was
 * worth keeping. Both are called saving and they are deliberately not one button: one
 * produces a template you write from, the other produces a shortlist you come back to.
 *
 * Deliberately not a bookmark icon: `SaveToVaultDialog` already owns that shape, and the
 * two sitting side by side with the same glyph was the whole reason this pair read as
 * one action wearing two labels. A star ("worth another look") is the closest wordless
 * match for a shortlist, so it is the one thing that tells them apart before either
 * label is read.
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function keep() {
    startTransition(async () => {
      const result = await createSavedPostAction({ videoId, note: note.trim() || undefined });
      if (result.ok) {
        toast.success("Saved for Remix research");
        setOpen(false);
        setNote("");
        // The button's "saved" state is a prop straight off page.tsx's server fetch
        // (getSavedPostByVideoId), not local state — refresh so it flips to "Kept"
        // without Kai having to reload the page to see his own click take effect.
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function forget() {
    if (!saved) return;
    const removed = saved;
    startTransition(async () => {
      const result = await deleteSavedPostAction(removed.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      // Every destructive action in this app is undoable through its toast (Shell
      // lock rule) — the Vault list's own remove button does the same re-create,
      // matching saved-post-row.tsx.
      toast.success("Removed from saved posts", {
        action: {
          label: "Undo",
          onClick: async () => {
            const restored = await createSavedPostAction({ videoId, note: removed.note ?? undefined });
            if (!restored.ok) {
              toast.error(restored.error);
              return;
            }
            router.refresh();
          },
        },
      });
    });
  }

  if (saved) {
    return (
      <Button variant="outline" size="sm" onClick={forget} disabled={pending}>
        <Star className="size-3.5" fill="currentColor" /> Kept
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="save-post-button">
            <Star className="size-3.5" /> Keep this post
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keep this post</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="saved-post-note">Why it is worth keeping</FieldLabel>
          <Textarea
            id="saved-post-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The hook lands before the first cut"
            rows={3}
          />
          {/* Optional on purpose. A required field here would get filled with anything
              to get past it, and a note that says nothing is worse than no note. */}
          <FieldDescription>Optional. Remix research shows this next to the score.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" data-testid="save-post-confirm" onClick={keep} disabled={pending}>
            {pending ? "Keeping" : "Keep"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
