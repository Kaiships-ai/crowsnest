"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setChannelFleetsAction } from "@/server/actions/fleet-actions";
import type { ChannelRow, Fleet } from "@/server/queries/channels";

/**
 * The channel-table row dropdown's "Edit fleets" action (final-review finding B2) —
 * a checkbox list of every fleet, pre-checked from `channel.fleets` (already fetched
 * for the table's own display), saved as a full replace via setChannelFleetsAction
 * rather than one add/remove at a time.
 */
export function EditChannelFleetsDialog({
  channel,
  fleets,
  open,
  onOpenChange,
}: {
  channel: ChannelRow;
  fleets: Fleet[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(() => channel.fleets.map((f) => f.id));
  const [saving, setSaving] = useState(false);

  function toggle(fleetId: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, fleetId] : prev.filter((id) => id !== fleetId)));
  }

  async function save() {
    setSaving(true);
    const result = await setChannelFleetsAction(channel.id, selected);
    setSaving(false);
    if (result.ok) {
      toast.success("Fleets updated");
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit fleets for {channel.handle}</DialogTitle>
          <DialogDescription>Choose which fleets this channel belongs to.</DialogDescription>
        </DialogHeader>

        {fleets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fleets yet — create one from the Fleets rail first.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {fleets.map((fleet) => (
              <label key={fleet.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(fleet.id)}
                  onCheckedChange={(checked) => toggle(fleet.id, checked === true)}
                />
                {fleet.name}
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button onClick={save} disabled={saving || fleets.length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
