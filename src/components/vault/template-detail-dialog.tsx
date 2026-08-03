"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Trash2 } from "lucide-react";
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
import { renderTemplateText } from "@/components/vault/template-card";
import { deleteVaultItemAction } from "@/server/actions/vault-actions";
import type { VaultItemRow } from "@/server/queries/vault";

/** Full detail for a saved hook/style template (Vault Hooks/Styles tabs), opened
 * from the compact TemplateCard. Carries the Use in Remix and Delete actions, and the
 * delete confirm step, that used to live on the card face. */
export function TemplateDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: VaultItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Swap the detail dialog for the confirm one rather than stacking both open at
  // once, so there is only ever one backdrop on screen.
  function openConfirm() {
    onOpenChange(false);
    setConfirmOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteVaultItemAction(item.id);
    setDeleting(false);
    setConfirmOpen(false);
    if (result.ok) {
      toast.success("Template deleted");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  function useInRemix() {
    if (!item.sourceVideo) return;
    router.push(`/feed/${item.sourceVideo.videoId}/remix?${item.type}=${item.id}`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{item.title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <p className="max-h-[50vh] overflow-y-auto text-sm text-foreground">
              {renderTemplateText(item.templateText)}
            </p>

            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {item.sourceVideo ? (
              <Link
                href={`/feed/${item.sourceVideo.videoId}`}
                className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Play className="size-3" fill="currentColor" aria-hidden /> {item.sourceVideo.channelHandle}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Manual entry</span>
            )}
          </div>

          <DialogFooter className="justify-between sm:justify-between">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={openConfirm}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
            {/* Remix always starts from a source video (/feed/[videoId]/remix) — a
                manually created template has none, so there's nothing to remix into.
                The old fallback told the user to press Cmd K and pick a video, but the
                command palette only searches nav routes, not videos (truth pass,
                v1-gap-inventory.md). Hiding the button when it can't work beats an
                instruction that can't be followed. */}
            {item.sourceVideo && (
              <Button size="sm" variant="secondary" onClick={useInRemix}>
                Use in Remix
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{item.title}&rdquo;?</DialogTitle>
            <DialogDescription>This can&rsquo;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
