import type { ReactNode } from "react";

/** 2026-08-15 spec part 7: a mono line under each generated result naming the inputs
 *  that fed it. Reads only session data already in the calling component — no server
 *  round trip. Shared by stage-hook.tsx, stage-style.tsx, and stage-script.tsx so the
 *  three lines stay visually identical. */
export function GroundedIn({ children }: { children: ReactNode }) {
  return <p className="border-l-2 border-pos/40 bg-muted/20 px-2.5 py-1 font-mono text-2xs text-pos">grounded in: {children}</p>;
}
