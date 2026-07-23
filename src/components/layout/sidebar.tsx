"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

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
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
            />
            Never synced
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled
            aria-label="Sync now"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
