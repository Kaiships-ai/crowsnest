"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Field, FieldContent, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
 * niche), a read-only niche chip linking to Settings, and a target-length Select. */
export function StagePrompt({
  session,
  sourceTopic,
  niche,
  onUpdate,
}: {
  session: RemixSessionRow;
  sourceTopic: string;
  niche: string;
  onUpdate: (patch: { topic?: string; targetLengthSec?: number }) => void;
}) {
  const [defaultTopic] = useState(() => session.topic ?? `${sourceTopic} — for my niche`);
  const [topic, setTopic] = useState(defaultTopic);
  const [targetLengthSec, setTargetLengthSec] = useState(String(session.targetLengthSec ?? 45));

  // The prefilled topic is only local state until it's persisted — if the user never
  // touches the input and clicks Continue, the agent's prompts would otherwise read a null
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
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="remix-topic">What&rsquo;s this script about?</FieldLabel>
          <Input id="remix-topic" value={topic} onChange={(e) => commitTopic(e.target.value)} onBlur={persistTopic} />
        </Field>

        {/* Read-only here: the niche lives in Settings, so this row names the value and
            points at where it is edited rather than pretending to be an input. */}
        <Field>
          <FieldTitle>Niche</FieldTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="max-w-[320px] min-w-0 shrink">
              <span className="truncate">{niche}</span>
            </Badge>
            <Link href="/settings" className="shrink-0 font-mono text-2xs tracking-wide text-muted-foreground uppercase hover:text-foreground">
              Edit in Settings
            </Link>
          </div>
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor="remix-length">Target length</FieldLabel>
          </FieldContent>
          <Select items={LENGTH_ITEMS} value={targetLengthSec} onValueChange={(v) => commitLength(v as string)}>
            <SelectTrigger id="remix-length">
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
        </Field>
      </FieldGroup>
    </div>
  );
}
