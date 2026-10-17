/**
 * @vitest-environment jsdom
 *
 * Declared per-file, same convention as logs-view.test.tsx: this repo's vitest config
 * defaults to the node environment and only the components that actually touch the DOM
 * opt into jsdom. `@testing-library/jest-dom` isn't a dependency, so `toBeTruthy()`
 * stands in for `toBeInTheDocument()`.
 *
 * The rail had no coverage at all while it was 486 lines of hand-rolled markup. These
 * three assertions lock the contracts the rewrite onto the shadcn Sidebar block could
 * silently drop: exactly one active item, the Feed signal's hidden-at-zero rule, and
 * every nav group being rendered.
 */

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(cleanup);

// The rail calls usePathname for its active marker and useRouter().refresh() when a
// watched run finishes; the real implementations throw outside an App Router tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/feed",
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

import { Sidebar } from "./sidebar";
import { NAV_GROUPS } from "./nav-items";
import { NavigationBlockerProvider } from "./navigation-blocker";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderRail(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <NavigationBlockerProvider>
      <SidebarProvider defaultOpen>
        <Sidebar getStartedItems={[]} ideasInboxCount={0} feedOutlierCount={0} {...props} />
      </SidebarProvider>
    </NavigationBlockerProvider>,
  );
}

describe("Sidebar", () => {
  test("marks exactly the item matching the current pathname as active", () => {
    // Queries are scoped to `container`, not `document`: this repo's vitest config has
    // no `globals: true`, so testing-library's auto-cleanup afterEach never registers
    // and every render in this file stays in the document.
    const { container } = renderRail();

    const active = container.querySelectorAll('[data-slot="sidebar-menu-button"][data-active]');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain("Feed");
  });

  test("shows the Feed outlier count only when there is one", () => {
    const withCount = renderRail({ feedOutlierCount: 3 });
    const badges = withCount.container.querySelectorAll('[data-slot="sidebar-menu-badge"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("3");
    withCount.unmount();

    const withoutCount = renderRail({ feedOutlierCount: 0 });
    expect(withoutCount.container.querySelectorAll('[data-slot="sidebar-menu-badge"]').length).toBe(0);
  });

  test("renders every nav group label once", () => {
    const { container } = renderRail();

    for (const { group } of NAV_GROUPS) {
      expect(within(container).getAllByText(group).length).toBe(1);
    }
  });
});
