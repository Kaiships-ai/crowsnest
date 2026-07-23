"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/components/layout/nav-items";

type CommandMenuContextValue = {
  setOpen: (open: boolean) => void;
};

const CommandMenuContext = React.createContext<CommandMenuContextValue | null>(
  null
);

/**
 * Lets any descendant (e.g. the Topbar's search-trigger button) open the
 * same ⌘K palette that the global keydown listener below controls.
 */
export function useCommandMenu() {
  const ctx = React.useContext(CommandMenuContext);
  if (!ctx) {
    throw new Error("useCommandMenu must be used within <CommandMenu>");
  }
  return ctx;
}

/**
 * Wraps the shell in a provider that owns the ⌘K/Ctrl+K palette state and
 * renders the CommandDialog itself. Mounted once in `(shell)/layout.tsx`.
 */
export function CommandMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const contextValue = React.useMemo<CommandMenuContextValue>(
    () => ({ setOpen }),
    []
  );

  function runCommand(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandMenuContext.Provider value={contextValue}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search… jump to a page" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.href}
                value={item.label}
                onSelect={() => runCommand(item.href)}
              >
                <item.icon />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandMenuContext.Provider>
  );
}
