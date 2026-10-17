"use client";

/**
 * The Graph token card in Cài đặt, and the place the Tuần này broken-token line opens
 * (J6). It names what is wrong in words, never a zero or a guess; "Check connection" is a
 * live check that refreshes the cached status the broken-token line reads.
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
    body: "Instagram accepted the token but refused its insights. Generate a new token with the insights permissions and reconnect. Check connection cannot see this permission; the next measurement re-verifies it.",
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
  ownHandle: string | null;
  initialStatus: GraphTokenStatus;
  /** True once own_account_snapshots has at least one row — distinguishes "never
   *  measured" from "not connected", since a token can be configured and correct on a
   *  machine that has simply never run a measurement yet. */
  everMeasured: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  // router.refresh() (after Measure now, even a failed one) hands a new server status:
  // take it over the local one, or the panel keeps showing the state before the run.
  const [seenInitial, setSeenInitial] = useState(initialStatus);
  if (initialStatus !== seenInitial) {
    setSeenInitial(initialStatus);
    setStatus(initialStatus);
  }
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
      // A failed run can still have written rows (and changed the token state): show them.
      router.refresh();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.stoppedEarly === "budget" && result.callsUsed === 0) {
        toast.error("Measure now skipped: this hour's Graph calls are already spent. Try again later.");
        return;
      }
      const stopped =
        result.stoppedEarly === "rate_limited"
          ? " (stopped early: Instagram rate limit)"
          : result.stoppedEarly === "budget"
            ? result.limitedByRecentCalls
              ? " (stopped early: recent scheduled measurements already spent most of this hour's Graph calls)"
              : " (stopped early: hourly call budget)"
            : "";
      toast.success(`Measured @${ownHandle ?? status.username ?? "account"}: ${result.postsMeasured} of ${result.postsSeen} posts${stopped}`);
    });
  }

  const configured = status.state !== "not_configured";
  const connectedButNeverMeasured = status.state === "ok" && !everMeasured;
  const copy = connectedButNeverMeasured
    ? { title: "Connected, nothing measured yet", body: `Instagram confirms the token as @${status.username ?? ownHandle ?? "unknown"}, but no measurement has run.` }
    : STATE_COPY[status.state];

  return (
    <div className="max-w-[62ch]" data-testid="mine-connect-panel">
      <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Graph API</p>
      <p className="mt-3 text-lg font-medium text-foreground">{copy.title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>

      {!configured && (
        <div className="mt-5 border-l-2 border-border pl-4">
          <p className="text-sm text-muted-foreground">
            Set the Graph token and Graph user ID under{" "}
            <a href="#api-keys" className="text-foreground underline underline-offset-2">
              API keys
            </a>
            .
          </p>
          <p className="mt-3 text-sm text-muted-foreground">Connecting publishes reels and gives, from your own posts:</p>
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
