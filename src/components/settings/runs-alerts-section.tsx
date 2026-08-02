"use client";

/**
 * "Runs and alerts" settings section (Task 11). Two of its three DB-backed fields —
 * `syncSlaMinutes` and `remixSlaMinutes` — decide when a run counts as over budget;
 * `notifyOnSuccess` decides whether a clean run also raises a notification. All three
 * validate and save today (Task 6), but nothing reads them back yet: Task 12 is what
 * makes sync-engine.ts actually raise the sla_breach / run_finished notifications these
 * numbers describe. Same "not wired yet" honesty sync-section.tsx already gives
 * `syncCadenceMinutes` and `mediaRetentionDays` — see `WIRED` in
 * `src/server/settings/index.ts`.
 *
 * The fourth row, browser notifications, is not an `app_settings` value at all: it is
 * this page's own Notification API permission, and the browser — not this app — is the
 * source of truth for it. There is nothing to save there; the switch reflects and
 * requests that permission directly, and cannot revoke it (the platform doesn't allow
 * that from script), which is why turning it off just points at the browser's own
 * site settings instead of pretending to flip a bit this app doesn't own.
 */

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NumberField, SettingRow } from "./setting-field";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { AppSettingsView } from "@/server/settings";

export type RunsAlertsSettings = Pick<AppSettingsView, "syncSlaMinutes" | "remixSlaMinutes" | "notifyOnSuccess">;

// Static copy, not a live read of sync-engine.ts's LOCK_STALE_MS: that constant isn't
// exported, and this row is explicitly read-only ("reuses the reaper threshold, not set
// here"), matching the mockup's own hardcoded "90s (from reaper)".
const HEARTBEAT_STALE_LABEL = "90s (from reaper)";

const NOT_WIRED_NOTE =
  "Not wired yet. Stored and validated, but no run raises a notification off this number until sync-engine.ts is wired to it.";

// No external event ever changes hydration status; this only distinguishes the server
// snapshot from the client one, the same no-op-subscribe pattern appearance-section.tsx
// uses to read a browser-only API without a setState-in-effect call.
function subscribeNever() {
  return () => {};
}

function readNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function RunsAlertsSection({ initial }: { initial: RunsAlertsSettings }) {
  const [syncSla, setSyncSla] = useState(String(initial.syncSlaMinutes.value));
  const [remixSla, setRemixSla] = useState(String(initial.remixSlaMinutes.value));
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(initial.notifyOnSuccess.value);
  const [saving, setSaving] = useState(false);

  const dirty =
    syncSla !== String(initial.syncSlaMinutes.value) ||
    remixSla !== String(initial.remixSlaMinutes.value) ||
    notifyOnSuccess !== initial.notifyOnSuccess.value;

  async function save() {
    setSaving(true);
    const result = await updateAppSettingsAction({
      syncSlaMinutes: Number(syncSla),
      remixSlaMinutes: Number(remixSla),
      notifyOnSuccess,
    });
    setSaving(false);
    if (result.ok) toast.success("Runs and alerts settings saved");
    else toast.error(result.error);
  }

  // Mounted-gate before touching `Notification`, same reasoning as appearance-section.tsx
  // reading next-themes' client-only localStorage state: the server has no notion of this
  // browser's permission, so nothing renders as granted/denied until hydrated.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  // Only the setter is used, to force a re-render after `requestPermission` resolves —
  // `Notification.permission` itself isn't React state, so nothing else re-reads it
  // without one. The empty first slot keeps eslint from flagging an unused variable for a
  // value this component never reads back.
  const [, bumpPermissionTick] = useState(0);
  const permission = mounted ? readNotificationPermission() : "unsupported";

  async function toggleBrowserNotifications(next: boolean) {
    if (!mounted || typeof Notification === "undefined") return;
    if (!next) {
      toast.info("Browser notifications can only be turned off from this browser's site settings.");
      return;
    }
    const result = await Notification.requestPermission();
    bumpPermissionTick((t) => t + 1);
    if (result !== "granted") toast.error("Notifications are blocked. Enable them in this browser's site settings.");
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Runs and alerts</h2>
        <p className="text-sm text-muted-foreground">Time budgets and what gets an alert. Saved on this device.</p>
      </div>

      <div className="flex flex-col gap-2">
        <SettingRow
          label="Sync SLA budget"
          hint="A sync slower than this flags as over budget and raises a notification. It is never auto cancelled."
          warnNote={NOT_WIRED_NOTE}
        >
          <NumberField value={syncSla} onChange={setSyncSla} min={1} max={240} suffix="min" ariaLabel="Sync SLA budget minutes" />
        </SettingRow>
        <SettingRow label="Remix SLA budget" hint="Same for a remix stage run." warnNote={NOT_WIRED_NOTE}>
          <NumberField value={remixSla} onChange={setRemixSla} min={1} max={240} suffix="min" ariaLabel="Remix SLA budget minutes" />
        </SettingRow>
        <SettingRow
          label="Heartbeat staleness"
          hint="A running job with no heartbeat past this is treated as stuck. Reuses the existing reaper threshold, not set here."
        >
          <span className="font-mono text-sm text-muted-foreground">{HEARTBEAT_STALE_LABEL}</span>
        </SettingRow>
        <SettingRow
          label="Browser notifications"
          hint="Fire an OS style alert while a tab is open, even in the background."
          warnNote={permission === "unsupported" ? "This browser does not support notifications." : undefined}
        >
          <Switch
            checked={permission === "granted"}
            onCheckedChange={(checked) => void toggleBrowserNotifications(checked)}
            disabled={!mounted || permission === "unsupported"}
            aria-label="Browser notifications"
          />
        </SettingRow>
        <SettingRow label="Notify on success" hint="Off by default. Failures and SLA breaches always notify." warnNote={NOT_WIRED_NOTE}>
          <Switch checked={notifyOnSuccess} onCheckedChange={setNotifyOnSuccess} aria-label="Notify on success" />
        </SettingRow>
      </div>

      <Button onClick={save} disabled={!dirty || saving} className="w-fit" size="sm" variant="outline">
        {saving ? "Saving…" : "Save"}
      </Button>
    </section>
  );
}
