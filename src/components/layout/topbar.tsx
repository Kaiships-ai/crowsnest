"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { useCommandMenu } from "@/components/layout/command-menu";
import { Button } from "@/components/ui/button";

const ROUTE_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: "Dashboard" },
  { pattern: /^\/feed\/[^/]+\/remix$/, title: "Remix Studio" },
  { pattern: /^\/feed\/[^/]+$/, title: "Video Detail" },
  { pattern: /^\/feed$/, title: "Outlier Feed" },
  { pattern: /^\/channels\/[^/]+$/, title: "Channel Detail" },
  { pattern: /^\/channels$/, title: "Channels" },
  { pattern: /^\/vault$/, title: "Vault" },
  { pattern: /^\/settings$/, title: "Settings" },
];

function getPageTitle(pathname: string): string {
  return ROUTE_TITLES.find((entry) => entry.pattern.test(pathname))?.title ?? "Crowsnest";
}

export function Topbar() {
  const pathname = usePathname();
  const { setOpen } = useCommandMenu();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
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
  );
}
