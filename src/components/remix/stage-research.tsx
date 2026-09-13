"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";
import { buildResearchAction, updateStageAction } from "@/server/actions/remix-actions";
import type { StoredStructureSegment } from "@/server/llm/schemas";
import type { SavedPostRow } from "@/server/queries/saved-posts";
import type { ResearchNotes } from "@/server/services/remix";
import type { RemixSessionRow } from "@/server/services/remix";

/** A section divider matching the prototype's "source inputs, sent to every stage" /
 *  "reference, not sent" rows: a mono micro-label plus a rule filling the rest of the
 *  row. `tone` is purely a label color choice, not a repurposing of the score's amber
 *  (globals.css: amber is reserved for the score) — "input" reads as `text-pos`, the
 *  same muted green this codebase already uses for a positive/confirmed state. */
function SectionHeader({ children, tone }: { children: ReactNode; tone: "input" | "reference" }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("font-mono text-2xs tracking-wide uppercase", tone === "input" ? "text-pos" : "text-faint")}>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** The prototype's small tag next to each field label, naming which stages it feeds
 *  (or that it's reference-only). */
function FeedTag({ children, tone }: { children: ReactNode; tone: "input" | "reference" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-1.5 py-px font-mono text-2xs tracking-wide uppercase",
        tone === "input" ? "border-pos/40 text-pos" : "border-border text-faint"
      )}
    >
      {children}
    </span>
  );
}

function FieldLabel({ label, tag, tone }: { label: string; tag: string; tone: "input" | "reference" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="font-mono text-2xs tracking-wide text-faint uppercase">{label}</Label>
      <FeedTag tone={tone}>{tag}</FeedTag>
    </div>
  );
}

/** One structure beat, rendered as the 2-part beat (Q4): the note plus the verbatim
 *  per-beat transcript when the beat carries one. A beat analyzed before the per-beat
 *  transcript field shipped has no `transcript` — render its note alone rather than
 *  inventing a second part (anti-fabrication, matches write-brief.ts's absent-vs-empty
 *  distinction). */
function Beat({ beat }: { beat: StoredStructureSegment }) {
  return (
    <div className="border-b border-dashed border-border py-2 last:border-b-0">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium">{beat.label}</span>
        <span className="font-mono text-2xs text-faint">
          {beat.startSec}s to {beat.endSec}s
        </span>
      </div>
      {beat.transcript ? (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2 text-sm">
            <span className="w-16 shrink-0 pt-0.5 font-mono text-2xs uppercase text-faint">Note</span>
            <span>{beat.note}</span>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="w-16 shrink-0 pt-0.5 font-mono text-2xs uppercase text-pos">Said</span>
            <span>{beat.transcript}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm">{beat.note}</p>
      )}
    </div>
  );
}

/** DESIGN.md §2.5 stage ②, redesigned (2026-08-15 spec, part 3): the source signal
 * (why it worked, hook pattern, structure beats with their per-beat transcript) reads
 * as confirmed input feeding every later stage; the facts box is an optional addition
 * on top; the flat full transcript drops to a collapsed fallback for videos analyzed
 * before the per-beat transcript existed; the vault/similar lists demote to a
 * "reference, not sent" row. Auto-assembled on entry if empty — buildResearch makes
 * zero Claude calls, so this auto-build works in keyless mode. */
export function StageResearch({
  session,
  vaultSavedPosts,
  onNotesChange,
}: {
  session: RemixSessionRow;
  // queries/saved-posts.ts's getSavedPosts, most recent first — read live in
  // page.tsx (a Server Component) rather than persisted onto researchNotes, so a
  // later save/remove to the Vault shows up here on the next visit instead of a
  // frozen copy from whenever this session's research was first assembled
  // (v1-scope.md, Remix studio: "the point of saving a post is that it seeds the
  // next remix").
  vaultSavedPosts: SavedPostRow[];
  onNotesChange: (notes: ResearchNotes) => void;
}) {
  // Initialized once from the session prop — this component only mounts while the
  // Research stage is active, so a fresh mount is exactly when researchNotes.facts
  // should be picked up again; the auto-build effect below sets it directly the one
  // other time it changes (inside its .then(), not synchronously in the effect body).
  const [facts, setFacts] = useState(session.researchNotes?.facts ?? "");
  // Assembly can throw (buildResearch reads the db even though it makes no model
  // call), and its failure has to leave the skeleton for a retry rather than spin
  // forever (B-02). `attempt` bumping re-runs the effect for a manual retry.
  const [assemblyFailed, setAssemblyFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session.researchNotes) return;
    let cancelled = false;
    buildResearchAction(session.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          onNotesChange(result.notes);
          setFacts(result.notes.facts);
        } else {
          setAssemblyFailed(true);
        }
      })
      .catch(() => {
        // buildResearchAction rejected outright (threw before it could build a
        // Result) rather than returning {ok:false} — same failure surface either
        // way, so route it to the identical error+Retry branch.
        if (!cancelled) setAssemblyFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.researchNotes, onNotesChange, attempt]);

  // Checked directly (not via a derived bool) so TypeScript narrows
  // session.researchNotes to non-null for the rest of the component.
  if (session.researchNotes === null) {
    if (assemblyFailed) {
      return (
        <div className="flex flex-col gap-3" data-testid="remix-research-error">
          <p className="text-sm text-muted-foreground">
            Could not assemble research from the source post. You can retry, or continue and add your own facts on the
            next stages.
          </p>
          <Button
            variant="outline"
            className="self-start rounded-none"
            onClick={() => {
              setAssemblyFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Assembling research from the source post…</p>
        <Skeleton className="h-24 w-full rounded-none" />
        <Skeleton className="h-32 w-full rounded-none" />
      </div>
    );
  }

  const notes = session.researchNotes;
  const analysis = notes.sourceAnalysis;
  const tags = analysis ? [...analysis.formatTags, ...analysis.styleTags] : [];

  function commitFacts() {
    const updated = { ...notes, facts };
    onNotesChange(updated); // local sync in the orchestrator
    // buildResearch already persisted the rest; this is the one field the user can
    // edit after the fact.
    autosave(updateStageAction(session.id, { researchNotes: updated }));
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader tone="input">Source inputs, sent to every stage</SectionHeader>

      {analysis ? (
        <>
          <div className="flex flex-col gap-1.5">
            <FieldLabel label="Why it worked" tag="feeds hook, style, script" tone="input" />
            <p className="border-l-2 border-pos/40 bg-muted/30 p-3 text-sm">{analysis.whyItWorked}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel label="Hook pattern" tag="feeds hook" tone="input" />
            <div className="flex flex-wrap items-center gap-1.5 border-l-2 border-pos/40 bg-muted/30 p-3">
              <Badge variant="outline" className="rounded-none">
                {analysis.hookType}
              </Badge>
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="rounded-none">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel label="Structure beats, note + transcript" tag="feeds hook, style, script" tone="input" />
            <div className="border-l-2 border-pos/40 bg-muted/30 px-3">
              {analysis.structureSegments.map((beat, i) => (
                <Beat key={i} beat={beat} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This post has not been analyzed, so there is nothing to feed the stages yet. The remix falls back to your
          topic and niche.{" "}
          <Link href={`/feed/${session.sourceVideoId}`} className="hover:underline">
            Analyze the source post
          </Link>
          .
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="research-facts" className="font-mono text-2xs tracking-wide text-pos uppercase">
            Your additions (optional)
          </Label>
          <FeedTag tone="input">feeds hook, style, script</FeedTag>
        </div>
        <Textarea
          id="research-facts"
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          onBlur={commitFacts}
          placeholder="Add your own angle, stats, or opinion. The source above already flows through on its own."
          rows={4}
          className="border-l-2 border-l-pos/40"
        />
      </div>

      <details className="border border-dashed border-border p-2.5">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Full transcript fallback (only used when a beat has no per-beat transcript)
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">
          For videos analyzed before the per-beat transcript existed, some beats above carry only a note. This flat
          transcript is what generation falls back to for the words in that case. Re-analyze the source post to fill
          in the aligned per-beat version.
        </p>
        <p className="mt-2 border border-border p-3 text-sm text-muted-foreground">
          {notes.transcriptExcerpt ?? "No transcript available."}
        </p>
      </details>

      <SectionHeader tone="reference">Reference, not sent</SectionHeader>

      <div className="flex flex-col gap-1.5 opacity-80">
        <FieldLabel label="Saved from your vault" tag="reference" tone="reference" />
        {vaultSavedPosts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {vaultSavedPosts.map((row) => {
              const tier = heatTier(row.item.outlierScore);
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 border border-border p-2 text-sm">
                  <Link href={`/feed/${row.item.videoId}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-medium">{row.item.channel.handle}</span>
                    {row.item.caption && <span className="text-muted-foreground"> · {row.item.caption}</span>}
                  </Link>
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {formatCompact(row.item.viewCount)} views · vs {formatCompact(row.channelMedian)} median
                  </span>
                  <span data-num className={cn("shrink-0 font-mono", tier > 0 ? "text-score" : "text-muted-foreground")}>
                    {formatMultiplier(row.item.outlierScore)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your vault is empty.{" "}
            <Link href="/feed" className="hover:underline">
              Save a post from the feed
            </Link>{" "}
            to give research something to pull from.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 opacity-80">
        <FieldLabel label="Similar tracked outliers" tag="reference" tone="reference" />
        {notes.similar.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {notes.similar.map((item) => {
              const tier = heatTier(item.outlierScore);
              return (
                <li key={item.videoId} className="flex items-center justify-between gap-2 border border-border p-2 text-sm">
                  <Link href={`/feed/${item.videoId}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-medium">{item.channelHandle}</span>
                    {item.caption && <span className="text-muted-foreground"> · {item.caption}</span>}
                  </Link>
                  <span data-num className={cn("shrink-0 font-mono", tier > 0 ? "text-score" : "text-muted-foreground")}>
                    {formatMultiplier(item.outlierScore)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Analyze more videos to see patterns here.</p>
        )}
      </div>
    </div>
  );
}
