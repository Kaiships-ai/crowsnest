import type { ReactNode } from "react";

import { CommandMenu } from "@/components/layout/command-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getFailureStrip } from "@/server/queries/failure-surface";

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
  const strip = await getFailureStrip();

  return (
    <CommandMenu>
      {/* Flex, not a `grid-cols-[240px_1fr]` fixed track: the rail's own width (see
          Sidebar) is the only thing that decides how wide it is, so the content pane
          — `min-w-0` so its own children can still shrink/scroll — always gets every
          pixel that isn't rail. A fixed grid column would have kept the old 240px
          gutter reserved even after the rail collapsed to an icon strip. */}
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <Topbar strip={strip} />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </CommandMenu>
  );
}
