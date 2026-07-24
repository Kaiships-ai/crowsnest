"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { bridgeSyncAll } from "@/components/channels/sync-bridge";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSyncStatusAction } from "@/server/queries/sync-status-action";
import type { SyncStatusValue } from "@/server/queries/sync-status";

function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// DESIGN.md Task 7 Step 2 dot colors, verbatim.
const STATUS_DOT: Record<SyncStatusValue, string> = {
  never: "bg-muted-foreground",
  success: "bg-[#34D399]",
  running: "bg-[#E8B23D]",
  partial: "bg-[#E8B23D]",
  failed: "bg-[#F1585C]",
};

function statusLabel(status: SyncStatusValue, finishedAt: string | null): string {
  switch (status) {
    case "never":
      return "Never synced";
    case "running":
      return "Syncing…";
    case "success":
      return finishedAt ? `Synced ${relativeTime(finishedAt)}` : "Synced";
    case "partial":
      return finishedAt ? `Partial sync ${relativeTime(finishedAt)}` : "Partial sync";
    case "failed":
      return finishedAt ? `Sync failed ${relativeTime(finishedAt)}` : "Sync failed";
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<{ status: SyncStatusValue; finishedAt: string | null } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // getSyncStatusAction has no try/catch of its own (queries/sync-status-action.ts
    // is a bare passthrough) — a rejected promise here would otherwise leave `status`
    // stuck at its initial `null` forever with no feedback. `.catch` re-affirms that
    // same null (already the "never synced" fallback via STATUS_DOT/statusLabel's
    // `?? "never"`), it just makes the fallback explicit rather than incidental.
    getSyncStatusAction()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function refresh() {
    setPending(true);
    const result = await bridgeSyncAll();
    if (!result.ok) toast.error(result.error);
    getSyncStatusAction()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setPending(false));
  }

  return (
    <aside className="flex h-full flex-col border-r border-border bg-card">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Crowsnest
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <div key={item.href} className="relative">
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                />
              )}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mx-3 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <Separator className="mb-3" />
        <div className="flex items-center justify-between gap-2 px-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2 truncate">
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status?.status ?? "never"])}
            />
            <span className="truncate">{statusLabel(status?.status ?? "never", status?.finishedAt ?? null)}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={refresh}
            disabled={pending}
            aria-label="Sync now"
          >
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
          </Button>
        </div>
      </div>
    </aside>
  );
}
