"use client";

// A throw in (shell)/layout.tsx itself bubbles past this to src/app/error.tsx.
import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The client-error reporter already lives in the shell; log to console so a dev sees
    // the real stack. Do not surface the raw message to the user.
    console.error("shell route error:", error);
  }, [error]);

  return <ErrorState reset={reset} />;
}
