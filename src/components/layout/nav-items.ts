import { CalendarDays, Radar, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that light this item. Nguồn and Cài đặt each own several routes. */
  match: string[];
};

/** The whole rail, shared with the command palette. Constants only: per-user counts are
 *  threaded in from `(shell)/layout.tsx` as props. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tuần này", icon: CalendarDays, match: [] },
  { href: "/feed", label: "Nguồn", icon: Radar, match: ["/feed", "/channels", "/sources"] },
  { href: "/settings", label: "Cài đặt", icon: Settings, match: ["/settings", "/logs", "/runs"] },
];

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
