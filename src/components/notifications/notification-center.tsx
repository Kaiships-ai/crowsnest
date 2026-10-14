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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
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

// One Badge variant per kind. `run_finished` is the only good-news kind, and `success`
// is not a Badge variant, so it carries the token directly.
const KIND_BADGE: Record<NotificationKind, { variant: "destructive" | "outline"; className?: string }> = {
  run_failed: { variant: "destructive" },
  sla_breach: { variant: "destructive" },
  run_finished: { variant: "outline", className: "text-[var(--success)]" },
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
          <Badge aria-hidden className="absolute -top-1.5 -right-1.5 h-[17px] min-w-[17px] px-1 font-mono tabular-nums">
            {unread > 99 ? "99+" : unread}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="max-h-[75vh] w-96 gap-0 overflow-y-auto p-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm text-muted-foreground">
            Notifications{unread > 0 ? ` · ${unread} unread` : ""}
          </CardTitle>
          <CardAction>
            <Button type="button" size="xs" variant="outline" onClick={handleMarkAllRead} disabled={unread === 0}>
              Mark all read
            </Button>
          </CardAction>
        </CardHeader>

        {notifications.length === 0 ? (
          <Empty className="p-6">
            <EmptyHeader>
              <EmptyTitle className="text-sm font-normal text-muted-foreground">No notifications yet.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {notifications.map((n) => {
              const unreadRow = n.readAt === null;
              const badge = KIND_BADGE[n.kind];
              return (
                <Item
                  key={n.id}
                  size="sm"
                  className={cn("rounded-none border-b last:border-b-0", unreadRow && "bg-muted/40")}
                >
                  <ItemMedia>
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", unreadRow ? "bg-foreground" : "bg-transparent")}
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <span className="truncate">{n.title}</span>
                      <Badge variant={badge.variant} className={cn("font-mono", badge.className)}>
                        {n.kind}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>{n.body}</ItemDescription>
                    <ItemDescription className="font-mono text-2xs">{relativeTime(n.createdAt)}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="self-start">
                    <Button type="button" size="xs" variant="outline" onClick={() => handleOpen(n)}>
                      Open
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </PopoverContent>
    </Popover>
  );
}
