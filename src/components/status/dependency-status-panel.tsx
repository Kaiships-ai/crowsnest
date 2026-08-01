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
import { cn } from "@/lib/utils";
import { getIgStatusAction } from "@/server/actions/ig-actions";
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
    <div className="mt-1.5 flex items-center gap-2">
      <code className="rounded bg-muted px-2 py-1 font-mono text-2xs text-foreground">{command}</code>
      <Button size="icon-xs" variant="ghost" aria-label="Copy command" title="Copy command" onClick={() => void copy()}>
        <Copy className="size-3.5" />
      </Button>
      {copied && <span className="text-2xs text-muted-foreground">Copied</span>}
    </div>
  );
}

export function DependencyStatusPanel({ sidecar: initialSidecar, llm: initialLlm, hasLlmKey }: DependencyStatusPanelProps) {
  const [sidecar, setSidecar] = useState(initialSidecar);
  const [llm, setLlm] = useState(initialLlm);
  const [isPending, startTransition] = useTransition();

  // Re-runs only the two live probes (getIgStatusAction, the same $0 ping the Settings
  // page's own "Test" button uses) — config facts (hasLlmKey, proxyUrl, routedThroughProxy)
  // don't change without a server restart, so they're reused from the initial classify.
  function recheck() {
    startTransition(async () => {
      const [igResult, pingResult] = await Promise.all([
        getIgStatusAction(),
        hasLlmKey ? withTimeout(testAnthropicKeyAction(), LLM_PING_TIMEOUT_MS) : Promise.resolve(undefined),
      ]);
      setSidecar(classifySidecarStatus(igResult));
      setLlm(
        classifyLlmStatus({
          hasKey: hasLlmKey,
          proxyUrl: initialLlm.proxyUrl,
          routedThroughProxy: initialLlm.routedThroughProxy,
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
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-4 border-l-2 bg-card px-5 py-4",
        tone === "bad" ? "border-destructive" : "border-destructive/50",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-2xs tracking-wide text-muted-foreground uppercase">Dependencies</p>
        <Button size="sm" variant="outline" onClick={recheck} disabled={isPending}>
          {isPending ? "Checking…" : "Check again"}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ROW_TONE[sidecarTone(sidecar.state)])} />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{sidecarHeadline(sidecar)}</p>
            {sidecar.detail && <p className="mt-0.5 text-xs text-muted-foreground">{sidecar.detail}</p>}
            {sidecar.state === "down" && <CopyCommand command={SIDECAR_START_COMMAND} />}
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", ROW_TONE[llmTone(llm.state)])} />
          <div className="min-w-0">
            <p className="text-sm text-foreground">{llmHeadline(llm)}</p>
            {llm.detail && <p className="mt-0.5 text-xs text-muted-foreground">{llm.detail}</p>}
            {llm.state === "reachable_unverified" && (
              <p className="mt-0.5 max-w-[52ch] text-xs text-muted-foreground">
                The proxy answered a token-count check, but that route doesn&rsquo;t call the model itself, so it is not proof Hook,
                Style, or Script will actually generate. Try one in Remix to know for sure.
              </p>
            )}
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground">{proxyLocationLine(llm)}</p>
            {llm.state === "not_configured" && (
              <Link href="/settings" className="mt-1.5 inline-block text-xs text-foreground underline underline-offset-2">
                Add API key in Settings
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
