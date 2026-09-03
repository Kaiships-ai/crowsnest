"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The single error surface every route boundary renders (src/app/(shell)/error.tsx,
 * src/app/error.tsx, and — inlined, since it needs its own <html> — global-error.tsx).
 * Square, destructive-toned, one neutral retry. Amber is never used here: the Amber Law
 * (DESIGN.md) reserves it for the score and one primary action, and an error is neither.
 */
export function ErrorState({
  title = "This page hit an error.",
  detail,
  reset,
}: {
  title?: string;
  detail?: string;
  reset?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-8 py-16">
      <div className="w-full max-w-[440px] border border-destructive/40 bg-card p-6">
        <span className="font-mono text-2xs tracking-wide text-destructive">ERROR</span>
        <h1 className="mt-3 text-lg leading-tight font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {detail ?? "The rest of the app is unaffected. Try again, and if it keeps happening, check Logs."}
        </p>
        {reset && (
          <Button variant="outline" className="mt-6" onClick={reset}>
            <RotateCw className="size-4" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}
