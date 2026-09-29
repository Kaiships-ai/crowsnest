"use client";

/**
 * The not-connected surface (WAVE2-BRIEF: "There is no Graph token on this machine, so
 * own channel insights return a not connected result. Design that state properly too.
 * It is what Kai sees.") This is not a loading skeleton standing in for numbers — it is
 * the honest primary state of this screen on a fresh machine, so it says exactly what is
 * missing and exactly what connecting would produce. Never a zero, never a guess.
 *
 * `checkGraphTokenAction` and `measureOwnChannelAction` are both real server actions
 * (graph-actions.ts) — the "Check again" / "Measure now" buttons here call the same
 * functions a Settings token strip would, there just isn't one built yet for the Graph
 * token (it's env-only config, `IG_GRAPH_TOKEN` / `IG_GRAPH_USER_ID` in `.env.local`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { checkGraphTokenAction, measureOwnChannelAction } from "@/server/actions/graph-actions";
import type { GraphTokenStatus } from "@/server/graph/client";

const STATE_COPY: Record<GraphTokenStatus["state"], { title: string; body: string }> = {
  not_configured: {
    title: "Instagram isn't connected here",
    body: "No Graph API token is set on this machine.",
  },
  auth_failed: {
    title: "Instagram rejected the token",
    body: "The configured Graph API token was rejected. It may have expired or been revoked.",
  },
  permission_denied: {
    title: "The token is missing a permission",
    body: "Instagram accepted the token but refused this call. Generate a new token with the insights permissions and reconnect.",
  },
  rate_limited: {
    title: "Instagram is rate limiting this token",
    body: "The Graph API is temporarily refusing calls for this token. This usually clears on its own.",
  },
  network: {
    title: "Couldn't reach Instagram",
    body: "The last check couldn't reach the Graph API at all. Check your connection.",
  },
  unknown: {
    title: "Connection status unknown",
    body: "The last check didn't return a state this app recognizes.",
  },
  ok: {
    title: "Connected",
    body: "",
  },
};

export function GraphConnectPanel({
  ownHandle,
  initialStatus,
  everMeasured,
}: {
  ownHandle: string;
  initialStatus: GraphTokenStatus;
  /** True once own_account_snapshots has at least one row — distinguishes "never
   *  measured" from "not connected", since a token can be configured and correct on a
   *  machine that has simply never run a measurement yet. */
  everMeasured: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [checking, startChecking] = useTransition();
  const [measuring, startMeasuring] = useTransition();

  function recheck() {
    startChecking(async () => {
      const result = await checkGraphTokenAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStatus(result.status);
      if (result.status.state === "ok") router.refresh();
    });
  }

  function measure() {
    startMeasuring(async () => {
      const result = await measureOwnChannelAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const stopped = result.stoppedEarly === "rate_limited" ? " (stopped early: Instagram rate limit)" : result.stoppedEarly === "budget" ? " (stopped early: hourly call budget)" : "";
      toast.success(`Measured @${ownHandle}: ${result.postsMeasured} of ${result.postsSeen} posts${stopped}`);
      router.refresh();
    });
  }

  const configured = status.state !== "not_configured";
  const connectedButNeverMeasured = status.state === "ok" && !everMeasured;
  const copy = connectedButNeverMeasured
    ? { title: "Connected, nothing measured yet", body: `Instagram confirms the token as @${status.username ?? ownHandle}, but no measurement has run.` }
    : STATE_COPY[status.state];

  return (
    <div className="mt-10 max-w-[62ch]" data-testid="mine-connect-panel">
      <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Graph API</p>
      <p className="mt-3 text-lg font-medium text-foreground">{copy.title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>

      {!configured && (
        <div className="mt-5 border-l-2 border-border pl-4">
          <p className="text-sm text-muted-foreground">
            Set <code className="font-mono text-2xs text-foreground">IG_GRAPH_TOKEN</code> and{" "}
            <code className="font-mono text-2xs text-foreground">IG_GRAPH_USER_ID</code> in{" "}
            <code className="font-mono text-2xs text-foreground">.env.local</code> and restart the app.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">Connecting gives this screen, from your own posts:</p>
          <ul className="mt-2 flex flex-col gap-1 font-mono text-2xs text-muted-foreground">
            <li>· reach, accounts reached per post</li>
            <li>· saves and shares per post</li>
            <li>· a median reach to read every post against</li>
          </ul>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={recheck} disabled={checking} data-testid="mine-connect-check">
          {checking ? "Checking…" : "Check connection"}
        </Button>
        {status.state === "ok" && !everMeasured && (
          <Button size="sm" onClick={measure} disabled={measuring} data-testid="mine-connect-measure">
            {measuring ? "Measuring…" : "Measure now"}
          </Button>
        )}
      </div>

      <p className="mt-6 font-mono text-2xs text-muted-foreground">
        last checked {new Date(status.checkedAt).toLocaleString("en-US")}
      </p>
    </div>
  );
}
