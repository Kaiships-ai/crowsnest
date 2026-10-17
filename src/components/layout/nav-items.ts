import { CalendarDays, Radar, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tuần này", icon: CalendarDays, match: [] },
  { href: "/feed", label: "Nguồn", icon: Radar, match: ["/feed", "/channels"] },
  { href: "/settings", label: "Cài đặt", icon: Settings, match: ["/settings", "/logs", "/runs"] },
];

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
