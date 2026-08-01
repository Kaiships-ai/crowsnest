import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { CommandMenu } from "@/components/layout/command-menu";
import type { GetStartedItem } from "@/components/layout/get-started-checklist";
import { Sidebar, type LastViewedPost } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ClientErrorReporter } from "@/components/logs/client-error-reporter";
import { getFailureStrip } from "@/server/queries/failure-surface";
import { getFirstRunGate } from "@/server/queries/first-run-gate";
import { getDashboardStats, getRecentlyViewed } from "@/server/queries/dashboard";
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
  // get-started-checklist.tsx for what each result backs.
  const [strip, recentlyViewed, stats, savedPosts] = await Promise.all([
    getFailureStrip(),
    getRecentlyViewed(1),
    getDashboardStats(),
    getSavedPosts(),
  ]);

  const lastViewedPost: LastViewedPost | null = recentlyViewed[0]
    ? { videoId: recentlyViewed[0].videoId, label: recentlyViewed[0].caption ?? recentlyViewed[0].channel.handle }
    : null;

  // Four real facts, not the prototype's four session flags — see
  // get-started-checklist.tsx's module doc for why those two lists differ.
  const getStartedItems: GetStartedItem[] = [
    { key: "setup", label: "Finish setup", href: "/first-run", done: gate.firstRunCompleted },
    { key: "channel", label: "Watch a channel", href: "/channels", done: stats.channelsTracked > 0 },
    { key: "save", label: "Save a post", href: "/feed", done: savedPosts.length > 0 },
    { key: "script", label: "Draft a script", href: "/vault?tab=scripts", done: stats.scriptsDrafted > 0 },
  ];

  return (
    <CommandMenu>
      <ClientErrorReporter />
      {/* Flex, not a `grid-cols-[240px_1fr]` fixed track: the rail's own width (see
          Sidebar) is the only thing that decides how wide it is, so the content pane
          — `min-w-0` so its own children can still shrink/scroll — always gets every
          pixel that isn't rail. A fixed grid column would have kept the old 240px
          gutter reserved even after the rail collapsed to an icon strip. */}
      <div className="flex h-screen">
        <Sidebar lastViewedPost={lastViewedPost} getStartedItems={getStartedItems} />
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <Topbar strip={strip} />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </CommandMenu>
  );
}
