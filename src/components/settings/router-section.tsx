"use client";

/**
 * 9router supervisor section (design decision: a full supervisor modeled on
 * `SidecarControl`/`InstagramSection`, the Instagram sidecar's own start/stop panel —
 * see `src/components/settings/sidecar-control.tsx`). 9router is the local LLM proxy
 * every AI feature (analyze, similar, remix) routes through; it keeps dying mid-session,
 * so this gives Kai the same visibility and control over it the sidecar already has.
 *
 * Three-state status, not a boolean: `reachable` alone is a false-green risk the
 * generation probe exists to close (see `src/server/llm/generation-probe.ts`'s module
 * doc) — a proxy that answers HTTP but whose model route is dead must never read as
 * healthy.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "./setting-field";
import { getRouterStatusAction, startRouterAction, stopRouterAction, type RouterStatus } from "@/server/actions/router-actions";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { AppSettingsView } from "@/server/settings";

type Tone = "ok" | "warn" | "bad";

function statusView(status: RouterStatus): { tone: Tone; label: string } {
  if (!status.reachable) return { tone: "bad", label: "Down" };
  if (!status.generationOk) return { tone: "warn", label: "Reachable, generation unverified" };
  return { tone: "ok", label: "Up" };
}

// Same tone -> icon/color mapping as InstagramSection's StatusRow ("warn" is the
// normal-but-not-fully-proven state here too — reachable but unverified generation is
// not an alarm, just honest).
function StatusDot({ tone }: { tone: Tone }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? CircleOff : AlertTriangle;
  const color = tone === "ok" ? "text-[var(--success)]" : tone === "bad" ? "text-destructive" : "text-foreground";
  return <Icon className={`size-4 shrink-0 ${color}`} aria-hidden />;
}

export function RouterSection({
  initialStatus,
  initialAutoManage,
}: {
  initialStatus: RouterStatus;
  initialAutoManage: AppSettingsView["routerAutoManage"];
}) {
  const [status, setStatus] = useState<RouterStatus>(initialStatus);
  const [autoManage, setAutoManage] = useState(initialAutoManage.value);
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | "check" | null>(null);
  const [savingToggle, setSavingToggle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = autoManage !== initialAutoManage.value;
  const view = statusView(status);

  async function refreshStatus(): Promise<RouterStatus> {
    const next = await getRouterStatusAction();
    setStatus(next);
    return next;
  }

  async function handleStart() {
    setBusy("start");
    setError(null);
    const result = await startRouterAction();
    if (!result.ok) setError(result.error);
    await refreshStatus();
    setBusy(null);
  }

  async function handleStop() {
    setBusy("stop");
    setError(null);
    const result = await stopRouterAction();
    if (!result.ok) setError(result.error);
    await refreshStatus();
    setBusy(null);
  }

  async function handleRestart() {
    setBusy("restart");
    setError(null);
    const stopResult = await stopRouterAction();
    if (!stopResult.ok) {
      setError(stopResult.error);
      setBusy(null);
      return;
    }
    const startResult = await startRouterAction();
    if (!startResult.ok) setError(startResult.error);
    await refreshStatus();
    setBusy(null);
  }

  async function handleCheck() {
    setBusy("check");
    setError(null);
    await refreshStatus();
    setBusy(null);
  }

  async function saveAutoManage() {
    setSavingToggle(true);
    const result = await updateAppSettingsAction({ routerAutoManage: autoManage });
    setSavingToggle(false);
    if (result.ok) toast.success("9router settings saved");
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>9router</CardTitle>
        <CardDescription>
          The local proxy that routes generation calls to your Claude API key. You need it running for the AI steps -
          video analysis, remix generation, and idea generation - to work. Leave it on auto-manage unless you run your
          own proxy.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon">
            <StatusDot tone={view.tone} />
          </ItemMedia>
          {/* The testid stays on the node that holds exactly the dot's label line, so
              `router-status-badge` still reads "9router: <state>" and nothing else. */}
          <ItemContent data-testid="router-status-badge">
            <ItemTitle>9router: {view.label}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ButtonGroup>
              <Button size="sm" variant="outline" data-testid="router-check-button" onClick={() => void handleCheck()} disabled={busy !== null}>
                {busy === "check" ? <Spinner aria-hidden /> : null}
                Check
              </Button>
              <Button size="sm" variant="secondary" data-testid="router-start-button" onClick={() => void handleStart()} disabled={busy !== null}>
                {busy === "start" ? "Starting…" : "Start"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleRestart()} disabled={busy !== null}>
                {busy === "restart" ? "Restarting…" : "Restart"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleStop()} disabled={busy !== null}>
                {busy === "stop" ? "Stopping…" : "Stop"}
              </Button>
            </ButtonGroup>
          </ItemActions>
        </Item>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Spawns <code>9router --tray --no-browser --skip-update</code>, logging to <code>~/.crowsnest/9router.log</code>. The process keeps
          running after this page reloads; Stop tears down only the process this app started, tracked by its own pid.
        </p>

        <FieldGroup>
          <SettingRow
            label="Auto-manage"
            hint="When on, the app starts 9router if it isn't running and makes one guarded restart attempt (with a cooldown) each time this page's status is read. When off, the app only observes — it never spawns 9router on its own."
          >
            <Switch checked={autoManage} onCheckedChange={setAutoManage} aria-label="Auto-manage 9router" />
          </SettingRow>
        </FieldGroup>
      </CardContent>

      <CardFooter>
        <Button onClick={() => void saveAutoManage()} disabled={!dirty || savingToggle} size="sm" variant="outline">
          {savingToggle ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
