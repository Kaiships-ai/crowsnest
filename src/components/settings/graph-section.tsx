"use client";

/**
 * Settings' Graph API status strip (WAVE2-BRIEF: "There is no Graph token on this
 * machine, so own channel insights return a not connected result. Design that state
 * properly too."). This is a separate connection from the Instagram section above it:
 * that one is the scraping session the sync engine reads other channels through; this
 * one is the Graph API token My channel's own-account Insights read through
 * (`checkGraphTokenAction`, `src/server/actions/graph-actions.ts`). Neither one implies
 * the other is connected.
 *
 * The full connect-and-measure flow already lives on My channel
 * (`src/components/mine/graph-connect-panel.tsx`) — this strip only answers "is it
 * connected" and says what connecting unlocks, so Settings stays the place Kai checks
 * every connection from without duplicating My channel's "Measure now" action here.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import type { GraphTokenStatus } from "@/server/graph/client";

const STATE_LABEL: Record<GraphTokenStatus["state"], string> = {
  ok: "Connected",
  not_configured: "Not connected",
  auth_failed: "Token rejected",
  permission_denied: "Missing permission",
  rate_limited: "Rate limited",
  network: "Unreachable",
  unknown: "Unknown",
};

const STATE_DETAIL: Record<GraphTokenStatus["state"], string> = {
  ok: "",
  not_configured: "No Graph API token is set on this machine.",
  auth_failed: "The configured token was rejected. It may have expired or been revoked.",
  permission_denied: "The token works but lacks a permission. Generate a new one with the insights permissions.",
  rate_limited: "Instagram is temporarily rate limiting this token. This usually clears on its own.",
  network: "The last check couldn't reach the Graph API at all.",
  unknown: "The last check returned a state this app doesn't recognize.",
};

export function GraphSection({ initialStatus }: { initialStatus: GraphTokenStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [checking, startChecking] = useTransition();

  function recheck() {
    startChecking(async () => {
      const result = await checkGraphTokenAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStatus(result.status);
    });
  }

  const connected = status.state === "ok";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram Graph API</CardTitle>
        <CardDescription>
          An optional Instagram Graph API token that powers My channel&apos;s own stats and reach. You only need it if you want those metrics for your own channel; it is a separate connection from the Instagram sync above (which reads other channels), and connecting or disconnecting one does not affect the other.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <Item variant="outline" size="sm">
          <ItemMedia>
            <Badge variant={connected ? "secondary" : "outline"}>{STATE_LABEL[status.state]}</Badge>
          </ItemMedia>
          <ItemContent>
            <ItemDescription>
              {connected ? `@${status.username ?? "unknown"}` : STATE_DETAIL[status.state]}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm" variant="outline" onClick={recheck} disabled={checking}>
              {checking ? "Checking…" : "Recheck"}
            </Button>
          </ItemActions>
        </Item>

        {!connected && (
          <p className="text-xs text-muted-foreground">
            Connecting enables My channel&apos;s six stat tiles, reach-by-post bars, and progress toward the post count where a score appears.
            All of it is read-only, own-account only; this app never posts. Set <code>IG_GRAPH_TOKEN</code> and <code>IG_GRAPH_USER_ID</code> in{" "}
            <code>.env.local</code> and restart the app.
          </p>
        )}
      </CardContent>

      <CardFooter>
        <p className="font-mono text-2xs text-muted-foreground">last checked {new Date(status.checkedAt).toLocaleString("en-US")}</p>
      </CardFooter>
    </Card>
  );
}
