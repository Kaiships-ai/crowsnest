"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type NavigationBlockerContextValue = {
  isBlocked: boolean;
  setIsBlocked: (isBlocked: boolean) => void;
};

const NavigationBlockerContext = createContext<NavigationBlockerContextValue | null>(null);

/**
 * Shared "don't leave silently" flag. A page that holds state a navigation would
 * otherwise drop (so far: the channels kanban board's unsaved drag moves) sets this while
 * dirty; the sidebar's nav links read it to confirm before firing. Same
 * provider/consumer shape as `useCommandMenu` next door, and for the same reason: the two
 * sides of the guard live in different parts of the tree and need one shared source of
 * truth, not a duplicated one.
 */
export function useNavigationBlocker() {
  const ctx = useContext(NavigationBlockerContext);
  if (!ctx) {
    throw new Error("useNavigationBlocker must be used within <NavigationBlockerProvider>");
  }
  return ctx;
}

/** Mounted once in `(shell)/layout.tsx`, above both the sidebar and the routed page, so
 *  a page can flip the flag and the sidebar sees it on the very next render. */
export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  const value = useMemo<NavigationBlockerContextValue>(() => ({ isBlocked, setIsBlocked }), [isBlocked]);
  return <NavigationBlockerContext.Provider value={value}>{children}</NavigationBlockerContext.Provider>;
}
