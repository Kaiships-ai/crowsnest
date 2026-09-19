import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CommandMenu } from "@/components/layout/command-menu";
import type { GetStartedItem } from "@/components/layout/get-started-checklist";
import { NavigationBlockerProvider } from "@/components/layout/navigation-blocker";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ClientErrorReporter } from "@/components/logs/client-error-reporter";
import { getFailureStrip } from "@/server/queries/failure-surface";
import { getFirstRunGate } from "@/server/queries/first-run-gate";
import { getDashboardStats, getNewFeedOutliers } from "@/server/queries/dashboard";
import { countInboxIdeas } from "@/server/queries/ideas";
import { getSavedPosts } from "@/server/queries/saved-posts";

// Same reasoning as `(shell)/page.tsx`'s own `force-dynamic`: a layout has no route
// param or searchParams of its own to implicitly opt out of static rendering, so without
// this `next build` would be free to render `getFailureStrip()` once at build time and
// freeze the shell's failure strip there — the exact "numbers frozen at build time" bug
// that comment warns about, just one layer up.
export const dynamic = "force-dynamic";

// A server component on purpose: `getFailureStrip()` reads `sync_jobs` directly, and
// this is the one place in the shell allowed to await a query and hand the result down
// as a prop, the same pattern `(shell)/page.tsx` uses for its own queries. It re-runs on
// every full navigation into the shell; a run that finishes while the shell is already
// mounted freshens the strip via `router.refresh()` in the sidebar (see the comment on
// its terminal-transition effect) rather than by polling this layout itself.
export default async function ShellLayout({ children }: { children: ReactNode }) {
  // A fresh install (first_run_completed unset, zero channels) never sees the shell at
  // all — see docs/product/v1-scope.md §2 "First run" AC 1. Checked before the failure
  // strip read below so a redirect never pays for a query it's about to throw away.
  const gate = await getFirstRunGate();
  if (gate.redirectToFirstRun) redirect("/first-run");

  // Four independent reads, none dependent on the others — the same "one Promise.all"
  // shape (shell)/page.tsx uses for its own queries. `getDashboardStats` and
  // `getSavedPosts` are reused as-is rather than duplicated in a leaner form: this is a
  // rendering-layer pass, and at this app's single-user/local-SQLite scale a couple of
  // extra count queries on a full navigation is not a real cost. See sidebar.tsx and
  // get-started-checklist.tsx for what each result backs. `countInboxIdeas` backs the
  // Ideas nav item's pending count (Task 9) — see nav-items.ts's module doc for why that
  // count is threaded down as a prop instead of living on NAV_ITEMS itself.
  const [strip, stats, savedPosts, ideasInboxCount, feedOutlierCount] = await Promise.all([
    getFailureStrip(),
    getDashboardStats(),
    getSavedPosts(),
    countInboxIdeas(),
    // The rail's live signal: outliers new since the creator last opened Feed. Read here
    // (not bumped) so it survives until they actually visit Feed, which moves the cutoff.
    getNewFeedOutliers(),
  ]);

  // Four real facts, not the prototype's four session flags — see
  // get-started-checklist.tsx's module doc for why those two lists differ.
  const getStartedItems: GetStartedItem[] = [
    { key: "setup", label: "Finish setup", href: "/first-run", done: gate.firstRunCompleted },
    { key: "channel", label: "Watch a channel", href: "/channels", done: stats.channelsTracked > 0 },
    { key: "save", label: "Save a post", href: "/feed", done: savedPosts.length > 0 },
    { key: "script", label: "Draft a script", href: "/vault?tab=scripts", done: stats.scriptsDrafted > 0 },
  ];

  // Read server-side so the rail renders at its persisted width on the first paint
  // instead of mounting expanded and snapping shut once the client reads the cookie.
  // `sidebar_state` is written by SidebarProvider itself (see ui/sidebar.tsx).
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <NavigationBlockerProvider>
      <CommandMenu>
        <ClientErrorReporter />
        <SidebarProvider defaultOpen={defaultOpen}>
          <Sidebar getStartedItems={getStartedItems} ideasInboxCount={ideasInboxCount} feedOutlierCount={feedOutlierCount} />
          {/* The shell is a fixed viewport with one inner scroller, not a long page:
              the topbar and the rail stay put while only the content moves. SidebarInset
              is itself the <main>, so the scroller is a plain div inside it rather than
              a second landmark. */}
          <SidebarInset className="h-svh min-h-0 overflow-hidden">
            <Topbar strip={strip} />
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </CommandMenu>
    </NavigationBlockerProvider>
  );
}
