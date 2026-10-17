"use client";

/**
 * A designed destructive confirm, so a real deletion or cancellation never goes through
 * the browser's `window.confirm` (DESIGN.md: destructive intent is a red WASH with red
 * text, not a red fill — failure is stated, not shouted). Square corners come from the
 * Dialog primitive; the only rounded thing here is the pill button, same as everywhere.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  testid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  testid: string;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid={testid}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid={`${testid}-cancel`}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy} data-testid={`${testid}-confirm`}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
