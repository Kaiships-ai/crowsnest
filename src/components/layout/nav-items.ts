import {
  Archive,
  Flame,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "Research" | "Create" | "Sources" | "System";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
};

/**
 * The 5 primary nav routes — shared between the sidebar and the ⌘K command
 * palette so the two stay in lockstep by construction.
 *
 * Grouping and order follow the prototype rail's RESEARCH / CREATE / SOURCES
 * / SYSTEM sections. The prototype also lists a "Post" entry under RESEARCH
 * and a "My channel" entry under SOURCES; neither is a top-level route here
 * (they're nested detail pages — `/feed/[videoId]` and a channel's own
 * detail view), so they're left out rather than faked.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/feed", label: "Feed", icon: Flame, group: "Research" },
  { href: "/vault", label: "Vault", icon: Archive, group: "Create" },
  { href: "/channels", label: "Channels", icon: Users, group: "Sources" },
  { href: "/mine", label: "My channel", icon: UserRound, group: "Sources" },
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "System" },
  { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];
