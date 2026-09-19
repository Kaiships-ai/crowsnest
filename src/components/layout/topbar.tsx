"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { useCommandMenu } from "@/components/layout/command-menu";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { FailureStrip } from "@/components/sync/failure-strip";
import { Button } from "@/components/ui/button";
import type { FailureStrip as FailureStripData } from "@/server/queries/failure-surface";

/**
 * Every route under `(shell)/` needs an entry here. A route that is missing one does not
 * fall back to something close, it falls back to "Crowsnest", so the topbar names the app
 * instead of the page and the h1 stops telling you where you are. /runs, /runs/[runId]
 * and /logs shipped without entries and read that way.
 *
 * Titles for a route that also sits in the rail match NAV_ITEMS' label exactly ("Runs",
 * "Logs"), so the highlighted rail entry and the heading agree. Detail routes follow the
 * sentence-case "Channel detail" / "Run detail" convention already set below — copy is
 * sentence case throughout per DESIGN-SYSTEM.md section 4.
 *
 * `first-run` deliberately has no entry: it lives outside the `(shell)` group and never
 * renders a Topbar at all.
 */
const ROUTE_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: "Dashboard" },
  { pattern: /^\/feed\/[^/]+\/remix$/, title: "Remix studio" },
  { pattern: /^\/feed\/[^/]+$/, title: "Post detail" },
  { pattern: /^\/feed$/, title: "Feed" },
  { pattern: /^\/ideas$/, title: "Ideas" },
  { pattern: /^\/channels\/discover$/, title: "Discover" },
  { pattern: /^\/channels\/[^/]+$/, title: "Channel detail" },
  { pattern: /^\/channels$/, title: "Channels" },
  { pattern: /^\/mine$/, title: "My channel" },
  { pattern: /^\/vault$/, title: "Vault" },
  { pattern: /^\/runs\/[^/]+$/, title: "Run detail" },
  { pattern: /^\/runs$/, title: "Runs" },
  { pattern: /^\/logs$/, title: "Logs" },
  { pattern: /^\/persona$/, title: "Persona" },
  { pattern: /^\/settings$/, title: "Settings" },
];

/** Exported for the guard test in topbar.test.ts, which walks the `(shell)` route tree on
 *  disk and fails if any route still falls through to the "Crowsnest" default. */
export function getPageTitle(pathname: string): string {
  return ROUTE_TITLES.find((entry) => entry.pattern.test(pathname))?.title ?? "Crowsnest";
}

export interface TopbarProps {
  /** The shell's failure surface, read once per server render by `(shell)/layout.tsx`
   *  via `getFailureStrip()`. `FailureStrip` (the component) freshens this against the
   *  live poll on its own — see its module doc — so a stale prop between navigations
   *  never outlives an actual run in flight. */
  strip: FailureStripData;
}

export function Topbar({ strip }: TopbarProps) {
  const pathname = usePathname();
  const { setOpen } = useCommandMenu();
  const title = getPageTitle(pathname);

  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <header className="flex h-14 shrink-0 items-center justify-between px-6">
        <h1 className="text-lg font-semibold">{title}</h1>

        <div className="flex items-center gap-3">
          {/* Reuses the shared pill Button rather than a hand-rolled square trigger — every
              clickable control in this app is a pill, this one included. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            className="h-8 w-64 justify-start gap-2 px-3 font-normal text-muted-foreground"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left text-sm">Search…</span>
            <kbd className="font-mono text-2xs text-muted-foreground">⌘K</kbd>
          </Button>
          <NotificationCenter />
          {/* Context action slot — later tasks inject a page-specific primary action here (e.g. "Add channel"). */}
        </div>
      </header>

      <FailureStrip strip={strip} />
    </div>
  );
}
