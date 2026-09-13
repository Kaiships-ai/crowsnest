"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { autosave } from "@/components/remix/autosave";
import { updateStageAction } from "@/server/actions/remix-actions";
import type { RemixSessionRow } from "@/server/services/remix";

const LENGTH_ITEMS = [
  { value: "30", label: "30s" },
  { value: "45", label: "45s" },
  { value: "60", label: "60s" },
  { value: "90", label: "90s" },
];

/** DESIGN.md §2.5 stage ①: topic (prefilled, transplants the source topic into Kai's
 * niche), a read-only niche chip linking to Settings, target-length Select, and the
 * "Quick Remix" shortcut alongside the (shared) Continue button. */
export function StagePrompt({
  session,
  sourceTopic,
  niche,
  hasLlmKey,
  proxyDown,
  quickRemixPending,
  onUpdate,
  onQuickRemix,
}: {
  session: RemixSessionRow;
  sourceTopic: string;
  niche: string;
  hasLlmKey: boolean;
  // Same signal Hook/Style/Script gate on (remix-studio.tsx's `proxyDown`, from
  // run-log-view.ts's `isProxyLikelyDown`) — Quick Remix runs those same three calls
  // server-side in one shot, so it needs the same gate, not a parallel one (B-11).
  proxyDown: boolean;
  quickRemixPending: boolean;
  onUpdate: (patch: { topic?: string; targetLengthSec?: number }) => void;
  onQuickRemix: () => void;
}) {
  const [defaultTopic] = useState(() => session.topic ?? `${sourceTopic} — for my niche`);
  const [topic, setTopic] = useState(defaultTopic);
  const [targetLengthSec, setTargetLengthSec] = useState(String(session.targetLengthSec ?? 45));

  // The prefilled topic is only local state until it's persisted — if the user never
  // touches the input and clicks Continue, generation would otherwise read a null
  // session.topic and silently fall back to the bare source caption (no "for my
  // niche" framing). Sync the prefill once, guarded so it only fires while
  // session.topic is still unset.
  useEffect(() => {
    if (session.topic === null) {
      onUpdate({ topic: defaultTopic });
      autosave(updateStageAction(session.id, { topic: defaultTopic }));
    }
  }, [session.id, session.topic, defaultTopic, onUpdate]);

  // onChange keeps local state + the orchestrator's Continue-gate check responsive;
  // the actual server persist is deferred to blur so typing doesn't fire a network
  // call per keystroke (length uses a Select, so its "blur" is really just onChange).
  function commitTopic(value: string) {
    setTopic(value);
    onUpdate({ topic: value });
  }

  function persistTopic() {
    autosave(updateStageAction(session.id, { topic }));
  }

  function commitLength(value: string) {
    setTargetLengthSec(value);
    onUpdate({ targetLengthSec: Number(value) });
    autosave(updateStageAction(session.id, { targetLengthSec: Number(value) }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="remix-topic" className="text-base font-normal text-foreground">
          What&rsquo;s this script about?
        </Label>
        <Input id="remix-topic" value={topic} onChange={(e) => commitTopic(e.target.value)} onBlur={persistTopic} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Niche</Label>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="max-w-[320px] rounded-none">
            <span className="truncate">{niche}</span>
          </Badge>
          <Link href="/settings" className="font-mono text-2xs tracking-wide text-faint uppercase hover:text-foreground">
            Edit in Settings
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remix-length" className="font-mono text-2xs tracking-wide text-faint uppercase">
          Target length
        </Label>
        <Select items={LENGTH_ITEMS} value={targetLengthSec} onValueChange={(v) => commitLength(v as string)}>
          <SelectTrigger id="remix-length" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LENGTH_ITEMS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(!hasLlmKey || proxyDown) && (
        // Blocked, not broken — the generation path is just offline, same as every
        // other stage's key/proxy gate. Prompt itself still works without it, so this
        // stays an inline note rather than swallowing the whole stage.
        <Alert className="rounded-none">
          <AlertTitle>{hasLlmKey ? "Local proxy unavailable" : "Add your Claude API key"}</AlertTitle>
          <AlertDescription>
            {hasLlmKey
              ? "The last attempt in the run log failed to connect. Start the local proxy, then retry — this stage isn't broken, it's offline."
              : "Add ANTHROPIC_API_KEY in Settings to generate hooks, outlines, and scripts."}
          </AlertDescription>
        </Alert>
      )}

      <Button
        variant="secondary"
        onClick={onQuickRemix}
        disabled={!topic || !hasLlmKey || proxyDown || quickRemixPending}
        className="w-fit"
      >
        {quickRemixPending ? "Running Quick Remix…" : "Quick Remix ✨"}
      </Button>
    </div>
  );
}
