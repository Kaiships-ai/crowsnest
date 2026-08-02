"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Thin client boundary so the root layout (a server component) can wrap children in
// next-themes without becoming a client component itself. All configuration is passed
// as props from layout.tsx, kept there so the theme policy reads in one place.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
