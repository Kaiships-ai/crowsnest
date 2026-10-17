"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type SectionTab = { href: string; label: string; testId: string; match?: string[] };

/** Link tabs: each tab is its own route, so deep links, Back and the route's own
 *  `searchParams` keep working. A tab is active on its href or any `match` prefix. */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const pathname = usePathname();
  const isActive = (tab: SectionTab) => [tab.href, ...(tab.match ?? [])].some((p) => pathname === p);
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border px-4 sm:px-6">
      {tabs.map((tab) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const SOURCES_TABS: SectionTab[] = [
  { href: "/feed", label: "Feed", testId: "sources-tab-feed" },
  { href: "/channels", label: "Kênh", testId: "sources-tab-channels" },
  { href: "/channels/discover", label: "Khám phá", testId: "sources-tab-discover" },
];

export const SETTINGS_TABS: SectionTab[] = [
  { href: "/settings", label: "Cấu hình", testId: "settings-tab-config" },
  { href: "/logs", label: "Nhật ký sự cố", testId: "settings-tab-incidents", match: ["/runs"] },
];

/** Nhật ký sự cố holds two views, the event log and the run history. */
export const INCIDENT_TABS: SectionTab[] = [
  { href: "/logs", label: "Log", testId: "incidents-tab-logs" },
  { href: "/runs", label: "Lần chạy", testId: "incidents-tab-runs" },
];

export function SourcesTabs() {
  return <SectionTabs tabs={SOURCES_TABS} label="Nguồn" />;
}

export function SettingsTabs() {
  return <SectionTabs tabs={SETTINGS_TABS} label="Cài đặt" />;
}
