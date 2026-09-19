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
 * external process (see `generation-blocked.tsx`'s identical reasoning for the Remix
 * screen) — the sidecar row offers a copyable command, never a "Start" button.
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
import { isRoutedThroughProxyAction } from "@/server/actions/router-actions";
import { testAnthropicKeyAction } from "@/server/actions/settings-actions";
import {
  bothHealthy,
  classifyLlmStatus,
  classifySidecarStatus,
  SIDECAR_START_COMMAND,
  withTimeout,
  LLM_PING_TIMEOUT_MS,
  type LlmStatus,
  type SidecarStatus,
} from "./dependency-status";

export interface DependencyStatusPanelProps {
  sidecar: SidecarStatus;
  llm: LlmStatus;
  /** Static for the life of the process (env vars read once at server start) — carried
   *  through so a "Check again" only re-runs the two live probes, not the config read. */
  hasLlmKey: boolean;
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

function llmTone(state: LlmStatus["state"]): "ok" | "warn" | "bad" {
  if (state === "up") return "ok";
  if (state === "not_configured" || state === "unknown" || state === "reachable_unverified") return "warn";
  return "bad";
}

function overallTone(sidecar: SidecarStatus, llm: LlmStatus): "warn" | "bad" {
  const sTone = sidecarTone(sidecar.state);
  const lTone = llmTone(llm.state);
  return sTone === "bad" || lTone === "bad" ? "bad" : "warn";
}

function proxyLocationLine(llm: LlmStatus): string {
  return llm.proxyUrl
    ? `Looked at ${llm.proxyUrl}${llm.routedThroughProxy ? " (LLM_BASE_URL)" : ""}.`
    : "Looked at the real Anthropic API. No LLM_BASE_URL is set.";
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

function llmHeadline(llm: LlmStatus): string {
  switch (llm.state) {
    case "up":
      return "Model backend is up.";
    case "not_configured":
      return "Model backend has no API key configured.";
    case "unknown":
      return "Model backend did not answer in time.";
    case "reachable_unverified":
      return "Model backend answered, but generation isn't confirmed.";
    case "down":
      // The distinction the false-green case demands: a proxy that answers with an
      // error status is a different, more specific fact than a proxy no one is home
      // at, and the two are fixed in completely different places.
      return llm.reachable
        ? "Model backend answered, but every attempt failed."
        : "Model backend is unreachable.";
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

export function DependencyStatusPanel({ sidecar: initialSidecar, llm: initialLlm, hasLlmKey }: DependencyStatusPanelProps) {
  const [sidecar, setSidecar] = useState(initialSidecar);
  const [llm, setLlm] = useState(initialLlm);
  const [isPending, startTransition] = useTransition();

  // Re-runs the live probes: getIgStatusAction, the same $0 ping the Settings page's own
  // "Test" button uses, and isRoutedThroughProxyAction (ENH-2) — that last one is a live
  // reachability check, not a static config fact, so it must be re-read here too, not
  // reused from the initial classify, or "Check again" could keep showing a stale
  // "routed through proxy" after the proxy actually died (or came back) mid-session.
  // `hasLlmKey`/`proxyUrl` alone are still config facts that only change on a restart.
  function recheck() {
    startTransition(async () => {
      const [igResult, pingResult, routedThroughProxy] = await Promise.all([
        getIgStatusAction(),
        hasLlmKey ? withTimeout(testAnthropicKeyAction(), LLM_PING_TIMEOUT_MS) : Promise.resolve(undefined),
        hasLlmKey ? isRoutedThroughProxyAction() : Promise.resolve(false),
      ]);
      setSidecar(classifySidecarStatus(igResult));
      setLlm(
        classifyLlmStatus({
          hasKey: hasLlmKey,
          proxyUrl: initialLlm.proxyUrl,
          routedThroughProxy,
          ping: pingResult ?? "timed_out",
        }),
      );
    });
  }

  if (bothHealthy(sidecar, llm)) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
        Instagram sidecar and model backend are both up.
      </p>
    );
  }

  const tone = overallTone(sidecar, llm);

  return (
    // Severity is the panel's border, not a destructive wash: this sits at the top of
    // the dashboard on every unhealthy load, so it has to read as a standing fact.
    <Card
      size="sm"
      role="status"
      aria-live="polite"
      className={cn(tone === "bad" ? "border border-destructive" : "border border-destructive/50")}
    >
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
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ROW_TONE[llmTone(llm.state)])} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{llmHeadline(llm)}</ItemTitle>
              {llm.detail && <ItemDescription>{llm.detail}</ItemDescription>}
              {llm.state === "reachable_unverified" && (
                <ItemDescription className="max-w-[52ch]">
                  The proxy answered a token-count check, but that route doesn&rsquo;t call the model itself, so it is not proof Hook,
                  Style, or Script will actually generate. Try one in Remix to know for sure.
                </ItemDescription>
              )}
              <ItemDescription className="font-mono text-2xs">{proxyLocationLine(llm)}</ItemDescription>
              {llm.state === "not_configured" && (
                <Link href="/settings" className="mt-1.5 inline-block text-xs text-foreground underline underline-offset-2">
                  Add API key in Settings
                </Link>
              )}
            </ItemContent>
          </Item>
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
