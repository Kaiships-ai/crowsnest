import type { ReactNode } from "react";

import { CommandMenu } from "@/components/layout/command-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ClientErrorReporter } from "@/components/logs/client-error-reporter";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <CommandMenu>
      <ClientErrorReporter />
      <div className="grid h-screen grid-cols-[240px_1fr]">
        <Sidebar />
        <div className="flex h-full min-h-0 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </CommandMenu>
  );
}
