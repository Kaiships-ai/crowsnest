"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { useCommandMenu } from "@/components/layout/command-menu";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { FailureStrip } from "@/components/sync/failure-strip";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { FailureStrip as FailureStripData } from "@/server/queries/failure-surface";

const ROUTE_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: "Tuần này" },
  { pattern: /^\/feed\/[^/]+\/remix$/, title: "Remix studio" },
  { pattern: /^\/feed\/[^/]+$/, title: "Post detail" },
  { pattern: /^\/feed$/, title: "Nguồn" },
  { pattern: /^\/channels\/discover$/, title: "Nguồn" },
  { pattern: /^\/channels\/[^/]+$/, title: "Channel detail" },
  { pattern: /^\/channels$/, title: "Nguồn" },
  { pattern: /^\/runs\/[^/]+$/, title: "Run detail" },
  { pattern: /^\/runs$/, title: "Nhật ký sự cố" },
  { pattern: /^\/logs$/, title: "Nhật ký sự cố" },
  { pattern: /^\/settings$/, title: "Cài đặt" },
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
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          {/* 16px, the stock `text-base`: this is shell chrome naming the page, not the
              page's own lead heading. */}
          <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* A dialog trigger, not a real input, so it stays a Button. It collapses to the
              bare icon below `sm`, where a 256px search affordance would crowd out the
              title it sits beside. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            aria-label="Search"
            className="h-8 w-8 justify-center gap-2 px-0 font-normal text-foreground sm:w-64 sm:justify-start sm:px-3"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="hidden flex-1 text-left text-sm sm:inline">Search…</span>
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </Button>
          <NotificationCenter />
          {/* Context action slot — later tasks inject a page-specific primary action here (e.g. "Add channel"). */}
        </div>
      </header>

      <FailureStrip strip={strip} />
    </div>
  );
}
