"use client";

/**
 * The dashboard's dependency status surface (v1-to-product-backlog.html A4). Renders
 * what `dependency-status.ts` classified, server-fetched once on page load and handed
 * down as props — same split as the shell's `FailureStrip` (`strip` fetched in
 * `layout.tsx`, rendered in a client component that can still re-check on demand).
 *
 * Quiet by design: DESIGN.md's failure-is-normal register applies here too, so a
 * healthy pair of dependencies is one muted line, not a card. The moment either one
 * isn't verifiably up, this becomes the loudest honest thing on the dashboard — because
 * per the brief, this is the single biggest thing between opening the app and getting a
 * script, and it should be readable before anything is clicked.
 *
 * No control here ever claims to start anything. This app has no mechanism to launch an
 * external process, so the sidecar row offers a copyable command, never a "Start" button.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import {
  bothHealthy,
  classifyGraphStatus,
  classifySidecarStatus,
  SIDECAR_START_COMMAND,
  withTimeout,
  PING_TIMEOUT_MS,
  type GraphStatus,
  type SidecarStatus,
} from "./dependency-status";

export interface DependencyStatusPanelProps {
  sidecar: SidecarStatus;
  graph: GraphStatus;
}

/** The severity dot each row leads with. It sits in the row's `ItemMedia`, so the row
 *  reads "signal, then sentence" without the sentence itself changing colour. */
const ROW_TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "bg-muted-foreground/40",
  warn: "bg-muted-foreground",
  bad: "bg-destructive",
};

function sidecarTone(state: SidecarStatus["state"]): "ok" | "bad" {
  return state === "up" ? "ok" : "bad";
}

function graphTone(state: GraphStatus["state"]): "ok" | "warn" | "bad" {
  if (state === "up") return "ok";
  if (state === "down") return "bad";
  return "warn";
}

function sidecarHeadline(sidecar: SidecarStatus): string {
  switch (sidecar.state) {
    case "up":
      return "Instagram sidecar is up.";
    case "down":
      return "Instagram sidecar is down.";
    case "error":
      return "Instagram sidecar reported a problem.";
  }
}

function graphHeadline(graph: GraphStatus): string {
  switch (graph.state) {
    case "up":
      return "Graph API is up.";
    case "not_configured":
      return "Graph API has no token configured.";
    case "unknown":
      return "Graph API check was inconclusive.";
    case "down":
      return "Graph API is failing.";
  }
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <InputGroup className="mt-1.5 w-fit">
      <InputGroupAddon align="inline-start">
        <InputGroupText className="font-mono text-2xs text-foreground">{command}</InputGroupText>
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        {copied && <InputGroupText className="text-2xs">Copied</InputGroupText>}
        <InputGroupButton size="icon-xs" aria-label="Copy command" title="Copy command" onClick={() => void copy()}>
          <Copy className="size-3.5" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export function DependencyStatusPanel({ sidecar: initialSidecar, graph: initialGraph }: DependencyStatusPanelProps) {
  const [sidecar, setSidecar] = useState(initialSidecar);
  const [graph, setGraph] = useState(initialGraph);
  const [isPending, startTransition] = useTransition();

  function recheck() {
    startTransition(async () => {
      const [igResult, graphResult] = await Promise.all([getIgStatusAction(), withTimeout(checkGraphTokenAction(), PING_TIMEOUT_MS)]);
      setSidecar(classifySidecarStatus(igResult));
      setGraph(
        graphResult === "timed_out"
          ? classifyGraphStatus(graphResult)
          : graphResult.ok
            ? classifyGraphStatus(graphResult.status)
            : { state: "unknown", detail: graphResult.error },
      );
    });
  }

  if (bothHealthy(sidecar, graph)) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
        Instagram sidecar and Graph API are both up.
      </p>
    );
  }

  return (
    // A flat inset well: it only renders inside StackHealthPanel, whose ring already
    // carries the severity, so a second tinted outline here would just double it.
    <Card size="sm" role="status" aria-live="polite" className="bg-muted/50 ring-0">
      <CardHeader>
        <CardTitle>Dependencies</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={recheck} disabled={isPending}>
            {isPending ? "Checking…" : "Check again"}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ItemGroup>
          <Item size="sm">
            <ItemMedia>
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ROW_TONE[sidecarTone(sidecar.state)])} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{sidecarHeadline(sidecar)}</ItemTitle>
              {sidecar.detail && <ItemDescription>{sidecar.detail}</ItemDescription>}
              {sidecar.state === "down" && <CopyCommand command={SIDECAR_START_COMMAND} />}
            </ItemContent>
          </Item>

          <Item size="sm">
            <ItemMedia>
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ROW_TONE[graphTone(graph.state)])} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{graphHeadline(graph)}</ItemTitle>
              {graph.detail && <ItemDescription>{graph.detail}</ItemDescription>}
              {graph.state !== "up" && (
                <Link href="/settings#graph-api" className="mt-1.5 inline-block text-xs text-foreground underline underline-offset-2">
                  Check Graph API in Settings
                </Link>
              )}
            </ItemContent>
          </Item>
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
