"use client";

import { useState } from "react";
import { CheckCircle2, CircleOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type { getIgStatusAction } from "@/server/actions/ig-actions";
import { sidecarProcessAliveAction, startSidecarAction, stopSidecarAction } from "@/server/actions/sidecar-actions";

type StatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;

/**
 * Start/stop control for the Instagram sidecar process, shown above the connection
 * panel where the manual `npm run ig:service` instruction used to be the only option.
 *
 * `health` is passed down from `InstagramSection`'s own status read rather than fetched
 * here on mount: this repo bans setting state from a mount effect, and the parent
 * already has the same `getIgStatusAction` result. Pid-liveness (`sidecarProcessAliveAction`)
 * has no such server-provided prop, so it starts `null` ("not checked yet") and is only
 * ever populated as the *result* of a Start/Stop click or the "Check" button below —
 * never from an effect that runs on its own.
 */
export function SidecarControl({ health, onHealthChange }: { health: StatusResult; onHealthChange: () => Promise<StatusResult> }) {
  const [pidAlive, setPidAlive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Running" and "show the Stop button" are the same condition (the pid is alive, or
  // health answers) — kept as one name used in two places rather than two names for one
  // value.
  const running = health.ok || pidAlive === true;

  async function refreshPidAlive() {
    setPidAlive(await sidecarProcessAliveAction());
  }

  async function handleStart() {
    setBusy("start");
    setError(null);
    const result = await startSidecarAction();
    if (!result.ok) setError(result.error);
    await onHealthChange();
    await refreshPidAlive();
    setBusy(null);
  }

  async function handleStop() {
    setBusy("stop");
    setError(null);
    const result = await stopSidecarAction();
    if (!result.ok) setError(result.error);
    await onHealthChange();
    await refreshPidAlive();
    setBusy(null);
  }

  async function handleCheck() {
    setBusy("check");
    await refreshPidAlive();
    setBusy(null);
  }

  const label = running ? "Running" : "Not running";
  const Icon = running ? CheckCircle2 : CircleOff;
  const color = running ? "text-[var(--success)]" : "text-muted-foreground";

  return (
    <Card size="sm">
      <Item size="sm">
        <ItemMedia variant="icon">
          <Icon className={color} aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Sidecar: {label}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <ButtonGroup>
            <Button size="sm" variant="outline" onClick={() => void handleCheck()} disabled={busy !== null}>
              {busy === "check" ? <Spinner aria-hidden /> : null}
              Check
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleStart()} disabled={busy !== null || running}>
              {busy === "start" ? "Starting…" : "Start"}
            </Button>
            {running && (
              <Button size="sm" variant="outline" onClick={() => void handleStop()} disabled={busy !== null}>
                {busy === "stop" ? "Stopping…" : "Stop"}
              </Button>
            )}
          </ButtonGroup>
        </ItemActions>
      </Item>
      <CardContent className="flex flex-col gap-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Spawns the sidecar the same way <code>npm run ig:service</code> does, with the shared service token and any configured Instagram
          credentials injected. The process keeps running after this page reloads; Stop tears it down.
        </p>
      </CardContent>
    </Card>
  );
}
