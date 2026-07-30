import type { ReactNode } from "react";

import { CommandMenu } from "@/components/layout/command-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default function ShellLayout({ children }: { children: ReactNode }) {
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
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </CommandMenu>
  );
}
