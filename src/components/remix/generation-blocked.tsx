"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The designed "blocked" surface for a generation stage (Hook/Style/Script), swapped
 * in for the whole stage rather than graying out controls that can't do anything
 * (v1-scope.md, Remix studio P0: "Blocked state when the local model proxy is down,
 * with a recovery action"). Two distinct reasons, because they're fixed two different
 * ways:
 *  - "no-key": `ANTHROPIC_API_KEY` is unset. Fixed in this app, in Settings.
 *  - "proxy-down": a key is configured (routing through the local 9router proxy) but
 *    the most recent attempt(s) in the run log below failed to connect — see
 *    `run-log-view.ts`'s `isProxyLikelyDown`. `src/server/llm/router-control.ts`'s
 *    `startRouter()` can launch 9router from this app (Settings' 9router section uses
 *    it), so the fix belongs there, not here: Settings already has Start/Restart
 *    controls, and this panel stays a link, not a duplicate button, to avoid two
 *    places that can both spawn the same process.
 */
export function GenerationBlocked({
  reason,
  feature,
  proxyUrl,
}: {
  reason: "no-key" | "proxy-down";
  /** e.g. "Hook generation", "Outline generation", "Script writing" — reused verbatim
   *  from each stage's own prior copy so this swap changes nothing but the reason. */
  feature: string;
  proxyUrl: string | null;
}) {
  if (reason === "no-key") {
    return (
      <div className="flex flex-col items-start gap-6 py-16">
        <p className="max-w-[38ch] text-lg text-foreground">{feature} needs a Claude API key.</p>
        <Button variant="secondary" render={<Link href="/settings" />}>
          Add API key in Settings
        </Button>
        <div className="max-w-[42ch] text-sm text-muted-foreground">
          <p>No key on hand? 9router is a free, keyless alternative - install it once from a terminal:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">npm install -g 9router</pre>
          <p className="mt-2">
            Then start it from{" "}
            <Link href="/settings#router" className="underline underline-offset-2 hover:text-foreground">
              Settings&apos; 9router section
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-6 py-16">
      <p className="max-w-[40ch] text-lg text-foreground">
        {proxyUrl ? (
          <>
            {feature} is blocked — nothing answered at <code className="font-mono text-base">{proxyUrl}</code>.
          </>
        ) : (
          <>{feature} is blocked — the local model proxy didn&rsquo;t answer.</>
        )}
      </p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        The last attempt in the run log below failed to connect. Start the local proxy in a terminal, then retry —
        this stage isn&rsquo;t broken, it&rsquo;s offline.
      </p>
    </div>
  );
}
