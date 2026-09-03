"use client";

// Root-segment error boundary. Catches what the shell boundary can't: a throw inside
// (shell)/layout.tsx (which awaits queries under force-dynamic), and a throw in the
// /first-run page. Renders the same recoverable surface.
import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("root route error:", error);
  }, [error]);

  return <ErrorState reset={reset} />;
}
