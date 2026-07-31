"use client";

/**
 * The channel-table row menu and the channel detail header's "Remove channel" action
 * (D1 on the V1-to-product backlog) — the write half of `removeChannelAction`
 * (channel-actions.ts). The untrack control used to exist here and got pulled during
 * the truth pass because no action backed it (a control nobody could complete is the
 * same defect as a missing one); it's back now that one does.
 *
 * "Remove" reads as destructive, so the confirm step says up front that this is a soft
 * removal — `deletedAt` gets set, not a row deleted — before Kai clicks anything.
 *
 * Refusal mirrors `deleteScriptAction`'s SCRIPT_CARRIED_BY_PLAN shape (remix-actions.ts):
 * the action names exactly which saved posts or planned posts are in the way rather
 * than a bare "can't remove this" toast, so this dialog renders that list instead of
 * swallowing it into `toast.error`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { removeChannelAction } from "@/server/actions/channel-actions";

type Refusal =
  | { code: "CHANNEL_HAS_SAVED_POSTS"; message: string; items: { id: string; label: string }[] }
  | { code: "CHANNEL_HAS_PLANNED_POSTS"; message: string; items: { id: string; label: string }[] }
  | { code: string; message: string; items?: undefined };

export function RemoveChannelDialog({
  channel,
  open,
  onOpenChange,
  /** Only the detail page needs this — the table just refreshes in place, the detail
   *  page has to leave a route that no longer resolves once the channel is gone. */
  onRemoved,
}: {
  channel: { id: string; handle: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  async function handleRemove() {
    setRemoving(true);
    const result = await removeChannelAction(channel.id);
    setRemoving(false);

    if (result.ok) {
      onOpenChange(false);
      toast.success(`${channel.handle} removed`);
      if (onRemoved) onRemoved();
      else router.refresh();
      return;
    }

    if (result.code === "CHANNEL_HAS_SAVED_POSTS") {
      setRefusal({
        code: result.code,
        message: result.error,
        items: (result.savedPosts ?? []).map((p) => ({ id: p.id, label: p.caption?.trim() || "Untitled saved post" })),
      });
      return;
    }
    if (result.code === "CHANNEL_HAS_PLANNED_POSTS") {
      setRefusal({
        code: result.code,
        message: result.error,
        items: (result.plannedPosts ?? []).map((p) => ({
          id: p.id,
          label: p.plannedDate ? `${p.title}, planned ${p.plannedDate}` : p.title,
        })),
      });
      return;
    }
    // CHANNEL_NOT_FOUND / CHANNEL_ALREADY_REMOVED / CHANNEL_UNKNOWN — nothing named to
    // list, a toast is the whole story.
    toast.error(result.error);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setRefusal(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {channel.handle}?</DialogTitle>
          <DialogDescription>
            This untracks the channel: it drops out of Channels and the Feed, and clears its &ldquo;own channel&rdquo; mark if this is the one
            set. It&rsquo;s a soft removal, not a delete &mdash; the channel and its posts stay in the database &mdash; but there&rsquo;s no
            button in the app yet to bring one back.
          </DialogDescription>
        </DialogHeader>

        {refusal && refusal.items && (
          // min-w-0 on every level from the grid item down: DialogContent is a CSS grid,
          // and a grid/flex item's default automatic min-width is its content's
          // min-content size — for a long, unbroken caption that's the whole line, wide
          // enough to blow past the dialog's max-width and spill out of the card
          // entirely rather than wrap or truncate inside it (caught in browser
          // verification: a real saved-post caption pushed the refusal box past the
          // dialog's right edge). min-w-0 breaks that propagation at the source.
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{refusal.message}</p>
            <ul className="flex min-w-0 max-h-40 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
              {refusal.items.map((item) => (
                <li key={item.id} className="min-w-0 truncate">
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleRemove()} disabled={removing}>
            {removing ? "Removing…" : "Remove channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
