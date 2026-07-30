"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteVaultItemAction } from "@/server/actions/vault-actions";
import type { VaultItemRow } from "@/server/queries/vault";

const SLOT_PATTERN = /(\{[a-zA-Z0-9_]+\})/g;

/** Renders `{topic}`-style slots in a template string as inline Badge chips
 * (DESIGN.md §2.6), everything else as plain text. */
function renderTemplateText(text: string) {
  return text.split(SLOT_PATTERN).map((part, i) => {
    const match = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (!match) return <span key={i}>{part}</span>;
    return (
      <Badge key={i} variant="secondary" className="mx-0.5 align-middle">
        {match[1]}
      </Badge>
    );
  });
}

export function TemplateCard({ item }: { item: VaultItemRow }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{item.title}</CardTitle>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {item.sourceVideo && (
                  <DropdownMenuItem render={<Link href={`/feed/${item.sourceVideo.videoId}`} />}>
                    View source video
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-3 text-sm text-muted-foreground">{renderTemplateText(item.templateText)}</p>

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

          {/* Remix always starts from a source video (/feed/[videoId]/remix) — a
              manually created template has none, so there's nothing to remix into.
              The old fallback told the user to press Cmd K and pick a video, but the
              command palette only searches nav routes, not videos (truth pass,
              v1-gap-inventory.md). Hiding the button when it can't work beats an
              instruction that can't be followed. */}
          {item.sourceVideo && (
            <Button size="sm" variant="secondary" onClick={useInRemix} className="w-fit">
              Use in Remix
            </Button>
          )}
        </CardContent>
      </Card>

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
