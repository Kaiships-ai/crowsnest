"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { useCommandMenu } from "@/components/layout/command-menu";
import { FailureStrip } from "@/components/sync/failure-strip";
import { Button } from "@/components/ui/button";
import type { FailureStrip as FailureStripData } from "@/server/queries/failure-surface";

const ROUTE_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: "Dashboard" },
  { pattern: /^\/feed\/[^/]+\/remix$/, title: "Remix Studio" },
  { pattern: /^\/feed\/[^/]+$/, title: "Video Detail" },
  { pattern: /^\/feed$/, title: "Outlier Feed" },
  { pattern: /^\/channels\/[^/]+$/, title: "Channel Detail" },
  { pattern: /^\/channels$/, title: "Channels" },
  { pattern: /^\/mine$/, title: "My channel" },
  { pattern: /^\/vault$/, title: "Vault" },
  { pattern: /^\/settings$/, title: "Settings" },
];

function getPageTitle(pathname: string): string {
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
            <kbd className="font-mono text-2xs text-faint">⌘K</kbd>
          </Button>
          {/* Context action slot — later tasks inject a page-specific primary action here (e.g. "Add channel"). */}
        </div>
      </header>

      <FailureStrip strip={strip} />
    </div>
  );
}
