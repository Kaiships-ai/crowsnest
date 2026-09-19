"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

/**
 * The bar that appears above the board footer while any channel is ticked. Purely
 * presentational: it owns no selection state and starts no sync itself, it just reports
 * the count and calls back. `startSyncAction` is the one seam all sync triggers reuse
 * (see ig-sync 02-architecture), so "Sync selected" is the per-card "Sync now" with more
 * than one id, and it is disabled while a sync is already running rather than queued.
 */
export function SyncSelectionBar({
  count,
  syncing,
  onSync,
  onClear,
}: {
  count: number;
  /** A sync already holds the single-flight lock; a second start would only be refused. */
  syncing: boolean;
  onSync: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-border bg-popover px-4 py-3 sm:px-6">
      <span className="text-xs text-muted-foreground">
        <span data-testid="channels-selection-count" data-num className="text-foreground">{count}</span>{" "}
        selected
      </span>
      <ButtonGroup>
        <Button variant="outline" size="sm" onClick={onClear}>Clear</Button>
        <Button
          data-testid="channels-sync-selected"
          variant="default"
          size="sm"
          disabled={count === 0 || syncing}
          onClick={onSync}
        >
          {syncing ? "Sync running" : "Sync selected"}
        </Button>
      </ButtonGroup>
    </div>
  );
}
