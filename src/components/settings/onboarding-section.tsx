"use client";

/**
 * v1-scope.md §2 "First run" AC 14 / §4 decision 1: "Settings has a control that clears
 * the flag and replays it." `firstRunCompleted` is a first-class `app_settings` key
 * (`src/server/settings/index.ts`, `WIRED: true` — read by the `(shell)` layout's route
 * guard, `src/server/queries/first-run-gate.ts`), so this control writes it through the
 * same generic `updateAppSettingsAction` every other Settings row already uses. No
 * second key, no bespoke action — the first-run flow owns `firstRunCompleted` end to
 * end (setting it true lives in the first-run flow itself, `src/components/first-run/`);
 * this is just the other direction of that same write path.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";

export function OnboardingSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function replay() {
    startTransition(async () => {
      const result = await updateAppSettingsAction({ firstRunCompleted: false });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      // /first-run is the flow's own route (src/components/first-run/onboarding-flow.tsx),
      // reachable directly regardless of what the (shell) redirect gate would otherwise
      // decide for an account that already has channels.
      router.push("/first-run");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
        <CardDescription>Replay the first-run setup: focus, connect, sources, first sync.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Replay first run
          </Button>
        </CardAction>
      </CardHeader>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replay the first-run setup?</DialogTitle>
            <DialogDescription>
              Clears the &ldquo;first run complete&rdquo; flag and sends you back through Focus, Connect, Sources, and First sync. Channels
              you already added, your niche profile, and the Instagram session all stay as they are. Nothing here deletes data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={replay} disabled={pending} variant="outline">
              {pending ? "Resetting…" : "Replay first run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
