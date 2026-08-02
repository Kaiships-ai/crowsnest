"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteFleetAction, renameFleetAction } from "@/server/actions/fleet-actions";
import { RenameFleetDialog } from "./rename-fleet-dialog";

export function FleetColumnMenu({
  fleetId,
  name,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
}: {
  fleetId: string;
  name: string;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  async function handleDelete() {
    setPendingDelete(true);
    const result = await deleteFleetAction(fleetId);
    setPendingDelete(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDeleting(false);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Fleet actions" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canMoveLeft} onClick={onMoveLeft}>
            <ChevronLeft /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveRight} onClick={onMoveRight}>
            <ChevronRight /> Move right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renaming && (
        <RenameFleetDialog
          fleetId={fleetId}
          currentName={name}
          open={renaming}
          onOpenChange={(o) => !o && setRenaming(false)}
          onRenamed={() => {
            setRenaming(false);
            router.refresh();
          }}
          rename={renameFleetAction}
        />
      )}

      {deleting && (
        <Dialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete fleet?</DialogTitle>
              <DialogDescription>
                &ldquo;{name}&rdquo; will be deleted and its channels move to Unassigned. This cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(false)} disabled={pendingDelete}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleDelete()} disabled={pendingDelete}>
                {pendingDelete ? "Deleting…" : "Delete fleet"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
