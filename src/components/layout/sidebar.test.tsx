/**
 * @vitest-environment jsdom
 *
 * Declared per-file, same convention as logs-view.test.tsx: this repo's vitest config
 * defaults to the node environment and only the components that actually touch the DOM
 * opt into jsdom. `@testing-library/jest-dom` isn't a dependency, so `toBeTruthy()`
 * stands in for `toBeInTheDocument()`.
 *
 * The rail had no coverage at all while it was 486 lines of hand-rolled markup. These
 * assertions lock the three-item rail (Tuần này, Nguồn, Cài đặt), exactly one active
 * item, the Feed signal's hidden-at-zero rule, and the redirects of the folded routes.
 */

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import nextConfig from "../../../next.config";
import { afterEach, describe, expect, test, vi } from "vitest";

// The rail calls usePathname for its active marker and useRouter().refresh() when a
// watched run finishes; the real implementations throw outside an App Router tree.
const nav = vi.hoisted(() => ({ pathname: "/feed", search: "" }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// Next's Link only calls onNavigate inside a real App Router; this stand-in calls it on
// click so the rail's optimistic highlight can be driven.
vi.mock("next/link", () => ({
  default: ({ href, onNavigate, ...rest }: { href: string; onNavigate?: (e: { preventDefault: () => void }) => void } & React.ComponentProps<"a">) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    />
  ),
}));

// The poll is the one thing in here that talks to the server. Pinned idle so the footer
// renders its resting state and nothing schedules a timer inside the test.
vi.mock("@/components/sync/use-sync-progress", () => ({
  useSyncProgress: () => ({
    progress: null,
    isRunning: false,
    stalled: false,
    error: null,
    start: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("@/components/week/week-tab", () => ({ WeekTab: () => null }));

import { Sidebar } from "./sidebar";
import { NAV_ITEMS } from "./nav-items";
import WeekPage from "@/app/(shell)/(loaded)/page";
import { NavigationBlockerProvider } from "./navigation-blocker";
import { SidebarProvider } from "@/components/ui/sidebar";

const rail = (props: Partial<React.ComponentProps<typeof Sidebar>> = {}) => (
  <NavigationBlockerProvider>
    <SidebarProvider defaultOpen>
      <Sidebar getStartedItems={[]} feedOutlierCount={0} {...props} />
    </SidebarProvider>
  </NavigationBlockerProvider>
);

const renderRail = (props: Partial<React.ComponentProps<typeof Sidebar>> = {}) => render(rail(props));

afterEach(() => {
  cleanup();
  nav.pathname = "/feed";
  nav.search = "";
});

const activeLabel = (container: HTMLElement) => container.querySelector('[data-slot="sidebar-menu-button"][data-active]')?.textContent;

describe("Sidebar", () => {
  test("shows exactly Tuần này, Nguồn and Cài đặt", () => {
    const { container } = renderRail();
    const labels = [...container.querySelectorAll('[data-slot="sidebar-menu-button"] a, a[data-slot="sidebar-menu-button"]')].map((a) => a.textContent?.trim());
    expect(labels).toEqual(["Tuần này", "Nguồn", "Cài đặt"]);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["Tuần này", "Nguồn", "Cài đặt"]);
  });

  test.each([
    ["/feed", "Nguồn"],
    ["/channels/discover", "Nguồn"],
    ["/channels/abc", "Nguồn"],
    ["/logs", "Cài đặt"],
    ["/runs/abc", "Cài đặt"],
    ["/settings", "Cài đặt"],
    ["/", "Tuần này"],
  ])("on %s exactly %s is active", (pathname, label) => {
    nav.pathname = pathname;
    const { container } = renderRail();
    const active = container.querySelectorAll('[data-slot="sidebar-menu-button"][data-active]');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain(label);
  });

  test("shows the Feed outlier count only when there is one", () => {
    const withCount = renderRail({ feedOutlierCount: 3 });
    const badges = withCount.container.querySelectorAll('[data-slot="sidebar-menu-badge"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("3");
    cleanup();

    const withoutCount = renderRail({ feedOutlierCount: 0 });
    expect(withoutCount.container.querySelectorAll('[data-slot="sidebar-menu-badge"]').length).toBe(0);
  });

  test("lights a clicked item at once and drops it when the route commits", () => {
    nav.pathname = "/";
    const view = renderRail();
    fireEvent.click(within(view.container).getByText("Cài đặt"));
    expect(activeLabel(view.container)).toContain("Cài đặt");

    nav.pathname = "/logs";
    view.rerender(rail());
    expect(activeLabel(view.container)).toContain("Cài đặt");
  });
});

describe("folded routes redirect to Tuần này", () => {
  test("persona, ideas and vault redirect to /, and /sources opens the Feed tab", async () => {
    const rules = await nextConfig.redirects!();
    const to = Object.fromEntries(rules.map((r) => [r.source, r.destination]));
    expect(to).toMatchObject({ "/persona": "/", "/ideas": "/", "/vault": "/", "/sources": "/feed" });
    expect(rules.every((r) => r.permanent === false)).toBe(true);
  });

  test.each(["overview", "calendar", "reels"])("/?tab=%s redirects to / without the query", async (tab) => {
    await expect(WeekPage({ searchParams: Promise.resolve({ tab }) })).rejects.toThrow("NEXT_REDIRECT /");
  });
});
