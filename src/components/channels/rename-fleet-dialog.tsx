"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RenameFleetDialog({
  fleetId,
  currentName,
  open,
  onOpenChange,
  onRenamed,
  rename,
}: {
  fleetId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
  rename: (fleetId: string, name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState(currentName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setName(currentName);
      setPending(false);
      setError(null);
    }
  }

  async function submit() {
    setPending(true);
    setError(null);
    const result = await rename(fleetId, name);
    setPending(false);
    if (result.ok) {
      onRenamed();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename fleet</DialogTitle>
          <DialogDescription>Change this fleet&apos;s name.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fleet-rename">Name</Label>
          <Input id="fleet-rename" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fitness Niche" />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
