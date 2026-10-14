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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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

        <FieldGroup>
          <Field data-invalid={error !== null || undefined}>
            <FieldLabel htmlFor="fleet-rename">Name</FieldLabel>
            <Input
              id="fleet-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fitness Niche"
              aria-invalid={error !== null || undefined}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
