import {
  Activity,
  CalendarDays,
  Archive,
  Compass,
  Drama,
  Flame,
  LayoutDashboard,
  Lightbulb,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "Overview" | "Create" | "Sources" | "System" | "Setup";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
};

/**
 * The fixed nav routes — shared between the sidebar and the ⌘K command
 * palette so the two stay in lockstep by construction. Every href here is a
 * constant, on purpose: the palette renders this list as-is with no per-user
 * data behind it.
 *
 * Order follows the creator's day and the product loop, not category: OVERVIEW
 * (Dashboard, the daily landing that answers "what to make next") leads, then
 * CREATE (the signal-to-remix loop: Feed, Ideas, Vault, in flow order), then
 * SOURCES (the inputs, configured less often), then SYSTEM (diagnostics) and
 * SETUP (config) at the bottom where infrequent tasks belong. Frequency and
 * journey both descend, so nothing daily sits below the fold. The own-account views
 * are Dashboard tabs, not a separate entry. "Post" is deliberately NOT here: the prototype's "Post" entry points
 * at whatever post is currently open, which has no fixed href to give this
 * array. sidebar.tsx renders it separately, right below Feed, using the same
 * `recently_viewed` fact the Dashboard's "Recently viewed" rail already reads
 * — real data, not a route that would 404 for a visitor who hasn't opened a
 * post yet (it's simply omitted for them, same as that rail).
 *
 * "Setup" (Task 6) holds Persona and Settings — the two screens that
 * configure how the app behaves rather than showing its output. Settings
 * moved here from System, and Persona is new.
 *
 * "Ideas" (Task 9) sits in Research right after Feed — the inbox of ideas
 * drawn from analyzed outliers, so it belongs beside the feed they come from rather than in Create (nothing lands in Create
 * until an idea is scripted). Its pending count is real per-user data, so it
 * is deliberately NOT a field on this array — same reasoning `sidebar.tsx`
 * already follows for `getStartedItems`: this array stays a constant the
 * palette can render as-is, and the count is threaded down from
 * `(shell)/layout.tsx` (`countInboxIdeas()`) as a prop instead.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tuần này", icon: CalendarDays, group: "Overview" },
  { href: "/?tab=overview", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/feed", label: "Feed", icon: Flame, group: "Create" },
  { href: "/ideas", label: "Ideas", icon: Lightbulb, group: "Create" },
  { href: "/vault", label: "Vault", icon: Archive, group: "Create" },
  { href: "/channels", label: "Channels", icon: Users, group: "Sources" },
  { href: "/channels/discover", label: "Discover", icon: Compass, group: "Sources" },
  { href: "/runs", label: "Runs", icon: Activity, group: "System" },
  { href: "/logs", label: "Logs", icon: ScrollText, group: "System" },
  { href: "/persona", label: "Persona", icon: Drama, group: "Setup" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Setup" },
];

/**
 * `NAV_ITEMS` folded into consecutive runs of the same group, in the same
 * order. The sidebar renders one `SidebarGroup` per entry; the ⌘K palette
 * still reads the flat `NAV_ITEMS`. Derived rather than authored so the two
 * cannot drift.
 */
export const NAV_GROUPS: { group: NavGroup; items: NavItem[] }[] = NAV_ITEMS.reduce(
  (acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else acc.push({ group: item.group, items: [item] });
    return acc;
  },
  [] as { group: NavGroup; items: NavItem[] }[],
);
