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
 * The 6 fixed nav routes — shared between the sidebar and the ⌘K command
 * palette so the two stay in lockstep by construction. Every href here is a
 * constant, on purpose: the palette renders this list as-is with no per-user
 * data behind it.
 *
 * Grouping and order follow the prototype rail's RESEARCH / CREATE / SOURCES
 * / SYSTEM sections. "My channel" is a real route (`/mine`) and lives here.
 * "Post" is deliberately NOT here: the prototype's "Post" entry points at
 * whatever post is currently open, which has no fixed href to give this
 * array. sidebar.tsx renders it separately, right below Feed, using the same
 * `recently_viewed` fact the Dashboard's "Recently viewed" rail already reads
 * — real data, not a route that would 404 for a visitor who hasn't opened a
 * post yet (it's simply omitted for them, same as that rail).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/feed", label: "Feed", icon: Flame, group: "Research" },
  { href: "/vault", label: "Vault", icon: Archive, group: "Create" },
  { href: "/channels", label: "Channels", icon: Users, group: "Sources" },
  { href: "/mine", label: "My channel", icon: UserRound, group: "Sources" },
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "System" },
  { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];
