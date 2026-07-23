import {
  Archive,
  Flame,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * The 5 primary nav routes — shared between the sidebar and the ⌘K command
 * palette so the two stay in lockstep by construction.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/feed", label: "Feed", icon: Flame },
  { href: "/channels", label: "Channels", icon: Users },
  { href: "/vault", label: "Vault", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings },
];
