"use client";

/**
 * The topbar bell: an unread-count badge over a popover panel of stored alerts (Task 4's
 * notifications store, via `notification-actions.ts`). A notification survives being
 * missed, which a toast cannot, so this is a mailbox, not a stream — it polls rather
 * than pushing, same tradeoff `use-sync-progress.ts` already made for run status.
 *
 * Data fetching lives inside `refresh`, an async callback invoked from an effect with
 * `void refresh()` (never `setState(...)` written directly in the effect body) — the
 * same shape `use-sync-progress.ts`'s `poll` uses, which is what keeps this clean under
 * `react-hooks/set-state-in-effect`. The mount-time permission request is a plain
 * browser side effect with no state write, so it needs no such guard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { listNotificationsAction, markAllReadAction, markReadAction } from "@/server/actions/notification-actions";
import type { NotificationKind, NotificationRow } from "@/server/notifications/store";

const POLL_MS = 15000;

// Kinds a browser Notification fires for. `run_finished` never does from here — the
// spec keeps success alerts opt-in (Task 6's `notifyOnSuccess`), gated server side at
// the point a `run_finished` row is even inserted, so this client only ever renders
// what it was given rather than re-deciding the policy.
const ALERT_KINDS = new Set<NotificationKind>(["run_failed", "sla_breach"]);

// Mockup chip variants (`.kind.fail` / `.kind.sla` / `.kind.done`), matched by name.
const KIND_CHIP_CLASS: Record<NotificationKind, string> = {
  run_failed: "text-destructive border-destructive/45",
  sla_breach: "text-destructive border-destructive/45",
  run_finished: "text-pos border-pos/40",
};

function fireBrowserNotification(n: NotificationRow): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    void new Notification(n.title, { body: n.body });
  } catch {
    // A handful of browsers throw on `new Notification` even once permission is
    // granted (iOS Safari among them). A missed alert is not worth crashing the bell.
  }
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  // null until the first load lands — that first load seeds "already known" without
  // alerting on it, so reopening the app doesn't re-fire every stored failure at once.
  const seenIdsRef = useRef<Set<number> | null>(null);

  const refresh = useCallback(async () => {
    const snapshot = await listNotificationsAction();
    const previouslySeen = seenIdsRef.current;
    const isFirstLoad = previouslySeen === null;
    const seen = previouslySeen ?? new Set<number>();
    for (const n of snapshot.notifications) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (!isFirstLoad && n.readAt === null && ALERT_KINDS.has(n.kind)) fireBrowserNotification(n);
    }
    seenIdsRef.current = seen;
    setNotifications(snapshot.notifications);
    setUnread(snapshot.unreadCount);
  }, []);

  useEffect(() => {
    // Both calls are nested inside a timer callback rather than invoked directly in the
    // effect body — a bare `void refresh()` here is flagged by react-hooks/set-state-in-
    // effect as a synchronous setState-during-effect even though `refresh` itself only
    // ever sets state after an `await`. Deferring the first tick through `setTimeout`
    // keeps the same "poll on mount, then every POLL_MS" behavior without tripping it.
    const kickoff = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [refresh]);

  // Ask once, only if the browser has never been asked. A plain side effect, not a
  // state write, so it needs no guard beyond the empty dependency array.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") void Notification.requestPermission();
  }, []);

  const handleOpen = useCallback(
    (n: NotificationRow) => {
      setOpen(false);
      if (n.readAt === null) {
        const now = new Date().toISOString();
        setNotifications((prev) => prev.map((row) => (row.id === n.id ? { ...row, readAt: now } : row)));
        setUnread((prev) => Math.max(0, prev - 1));
        void markReadAction(n.id);
      }
      if (n.runId) router.push(`/runs/${n.runId}`);
    },
    [router]
  );

  const handleMarkAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((row) => (row.readAt === null ? { ...row, readAt: now } : row)));
    setUnread(0);
    void markAllReadAction();
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 grid h-[17px] min-w-[17px] place-items-center border border-line-strong bg-popover px-1 font-mono text-[11px] font-semibold text-foreground"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 max-h-[75vh] gap-0 overflow-y-auto p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
          <span className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">
            Notifications{unread > 0 ? ` · ${unread} unread` : ""}
          </span>
          <Button type="button" size="xs" variant="outline" onClick={handleMarkAllRead} disabled={unread === 0}>
            Mark all read
          </Button>
        </div>

        {notifications.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul>
            {notifications.map((n) => {
              const unreadRow = n.readAt === null;
              return (
                <li
                  key={n.id}
                  className={cn("flex gap-3 border-b border-border px-3.5 py-3 last:border-b-0", unreadRow && "bg-popover/45")}
                >
                  <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", unreadRow ? "bg-foreground" : "bg-transparent")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="truncate">{n.title}</span>
                      <span className={cn("shrink-0 border px-1.5 py-px font-mono text-2xs", KIND_CHIP_CLASS[n.kind])}>{n.kind}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                    <p className="mt-1 font-mono text-2xs text-faint">{relativeTime(n.createdAt)}</p>
                  </div>
                  <Button type="button" size="xs" variant="outline" className="h-fit shrink-0 self-start" onClick={() => handleOpen(n)}>
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
