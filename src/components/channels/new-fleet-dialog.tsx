"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFleetAction } from "@/server/actions/fleet-actions";

/**
 * Replaces the fleet rail's old permanently-disabled "New fleet" button (tooltip:
 * "Coming with Vault phase" — a promise gone stale once Vault shipped without it,
 * final-review finding B2). Schema/queries were already fleet-ready; this dialog +
 * fleet-actions.ts's createFleetAction is the only missing piece.
 */
export function NewFleetDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setPending(false);
    }
  }

  async function submit() {
    setPending(true);
    const result = await createFleetAction(name);
    setPending(false);
    if (result.ok) {
      toast.success("Fleet created");
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="mt-1 justify-start gap-1.5 text-muted-foreground" />}>
        <Plus className="size-3.5" /> New fleet
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New fleet</DialogTitle>
          <DialogDescription>Group channels into a named watchlist.</DialogDescription>
        </DialogHeader>

        {/* A form, not just an Input + Button, so Enter in the name field submits the
            same way the button click does — matching how the Settings secret fields
            submit on Enter (secrets-section.tsx). */}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fleet-name">Name</Label>
            <Input id="fleet-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fitness Niche" />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
