"use client";

import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * The single error surface every route boundary renders (src/app/(shell)/error.tsx and
 * src/app/error.tsx). global-error.tsx does NOT use this: it renders its own <html>
 * outside the root layout, so globals.css never loads there and it must stay inline.
 *
 * Destructive-toned, one neutral retry. `primary` is never used here: it is reserved for
 * the one primary action per screen, and a recovery affordance on a broken page is not it.
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
    <Empty className="min-h-[60vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {detail ?? "The rest of the app is unaffected. Try again, and if it keeps happening, check Logs."}
        </EmptyDescription>
      </EmptyHeader>
      {reset && (
        <EmptyContent>
          <Button variant="outline" onClick={reset}>
            <RotateCw /> Try again
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
