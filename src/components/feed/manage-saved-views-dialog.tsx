"use client";

/**
 * The write half of the feed's "Saved views" dropdown (B1 on the V1-to-product
 * backlog). The dropdown itself only ever applied a view — this dialog is where
 * `createSavedViewAction`, `renameSavedViewAction`, and `deleteSavedViewAction`
 * (saved-view-actions.ts) actually get called from.
 *
 * One dialog rather than three: saving the current filters as a new view is the main
 * path (per the brief), so it sits at the top of the same screen that lists and
 * manages the views already there, instead of being its own separate modal a click
 * away.
 *
 * The two seeded presets ("Balanced", "High Conviction") are `isSystem` and every
 * mutating action refuses to touch one, with code SAVED_VIEW_IS_SYSTEM — so system
 * rows render with no Rename/Delete controls at all. A button that always answers "no"
 * shouldn't be there to click.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  createSavedViewAction,
  deleteSavedViewAction,
  renameSavedViewAction,
} from "@/server/actions/saved-view-actions";
import type { SavedFilterRow } from "@/server/queries/feed";

/** Same three keys `applyPreset` in filter-bar.tsx reads back — a view can only ever
 *  restore what it saved, so summarizing anything else here would promise a view does
 *  more than it does. */
function criteriaSummary(criteria: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof criteria.minScore === "number") parts.push(`${criteria.minScore}×+ score`);
  if (typeof criteria.minViews === "number") parts.push(`${criteria.minViews.toLocaleString()}+ views`);
  if (typeof criteria.sinceDays === "number") parts.push(`last ${criteria.sinceDays}d`);
  return parts.length > 0 ? parts.join(" · ") : "No filters";
}

export function ManageSavedViewsDialog({
  open,
  onOpenChange,
  savedFilters,
  currentCriteria,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedFilters: SavedFilterRow[];
  /** What the filter bar is showing right now, in the same shape `createSavedViewAction`
   *  persists — computed by the caller from its own applied filter state. */
  currentCriteria: Record<string, unknown>;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function resetRowState() {
    setEditingId(null);
    setPendingDeleteId(null);
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    const result = await createSavedViewAction({ name: trimmed, criteria: currentCriteria });
    setCreating(false);
    if (result.ok) {
      toast.success(`Saved "${trimmed}" as a view`);
      setNewName("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleRename(id: string) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setRenaming(true);
    const result = await renameSavedViewAction(id, trimmed);
    setRenaming(false);
    if (result.ok) {
      resetRowState();
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    const result = await deleteSavedViewAction(id);
    setDeleting(false);
    if (result.ok) {
      toast.success("View deleted");
      resetRowState();
      router.refresh();
    } else {
      toast.error(result.error);
      resetRowState();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          resetRowState();
          setNewName("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Saved views</DialogTitle>
          <DialogDescription>Save the feed&rsquo;s current filters as a view, or manage the ones you already have.</DialogDescription>
        </DialogHeader>

        <Card size="sm">
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Current filters: <span className="text-foreground">{criteriaSummary(currentCriteria)}</span>
            </p>
            <InputGroup>
              <InputGroupInput
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name this view"
                aria-label="New view name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  variant="default"
                  onClick={() => void handleCreate()}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? "Saving…" : "Save view"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </CardContent>
        </Card>

        <ItemGroup>
          {savedFilters.length === 0 && (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyTitle>No saved views yet.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {savedFilters.map((view) => {
            const isEditing = editingId === view.id;
            const isPendingDelete = pendingDeleteId === view.id;

            if (isEditing) {
              return (
                <Item key={view.id} size="sm">
                  <ItemContent>
                    <InputGroup>
                      <InputGroupInput
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        aria-label={`Rename ${view.name}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRename(view.id);
                          if (e.key === "Escape") resetRowState();
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          size="icon-xs"
                          aria-label="Confirm rename"
                          onClick={() => void handleRename(view.id)}
                          disabled={renaming || !editingName.trim()}
                        >
                          <Check />
                        </InputGroupButton>
                        <InputGroupButton size="icon-xs" aria-label="Cancel rename" onClick={resetRowState} disabled={renaming}>
                          <X />
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  </ItemContent>
                </Item>
              );
            }

            if (isPendingDelete) {
              return (
                <Item key={view.id} size="sm">
                  <ItemContent>
                    <ItemTitle className="text-muted-foreground">Delete &ldquo;{view.name}&rdquo;?</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ButtonGroup>
                      <Button size="xs" variant="outline" onClick={resetRowState} disabled={deleting}>
                        Cancel
                      </Button>
                      <Button size="xs" variant="destructive" onClick={() => void handleDelete(view.id)} disabled={deleting}>
                        {deleting ? "Deleting…" : "Delete"}
                      </Button>
                    </ButtonGroup>
                  </ItemActions>
                </Item>
              );
            }

            return (
              <Item key={view.id} size="sm">
                <ItemContent>
                  <ItemTitle>{view.name}</ItemTitle>
                  <ItemDescription>{criteriaSummary(view.criteria)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {view.isSystem ? (
                    // System presets are product configuration, not something Kai
                    // made — every rename/delete call on one comes back
                    // SAVED_VIEW_IS_SYSTEM, so there's nothing to offer here beyond
                    // saying plainly that it's fixed.
                    <Badge variant="outline" title="Built-in view, can't be changed">
                      <Lock /> Built-in
                    </Badge>
                  ) : (
                    <ButtonGroup>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Rename ${view.name}`}
                        onClick={() => {
                          setEditingId(view.id);
                          setEditingName(view.name);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${view.name}`}
                        onClick={() => setPendingDeleteId(view.id)}
                      >
                        <Trash2 />
                      </Button>
                    </ButtonGroup>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  );
}
