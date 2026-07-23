"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { useCommandMenu } from "@/components/layout/command-menu";

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
      <h1 className="text-base font-semibold">{title}</h1>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
        {/* Context action slot — later tasks inject a page-specific primary action here (e.g. "Add channel"). */}
      </div>
    </header>
  );
}
