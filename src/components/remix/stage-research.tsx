"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { autosave } from "@/components/remix/autosave";
import { formatCompact, formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { cn } from "@/lib/utils";
import { buildResearchAction, updateStageAction } from "@/server/actions/remix-actions";
import type { SavedPostRow } from "@/server/queries/saved-posts";
import type { ResearchNotes } from "@/server/services/remix";
import type { RemixSessionRow } from "@/server/services/remix";

/** DESIGN.md §2.5 stage ②: auto-assembled on entry if empty (source analysis +
 * transcript + top-5 similar), editable facts box, a live read of the Vault's saved
 * posts, and the similar-outliers list, both read-only. buildResearch makes zero
 * Claude calls, so this auto-build works in keyless mode. */
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

  useEffect(() => {
    if (session.researchNotes) return;
    let cancelled = false;
    buildResearchAction(session.id).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        onNotesChange(result.notes);
        setFacts(result.notes.facts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.researchNotes, onNotesChange]);

  // Checked directly (not via the `building` bool above) so TypeScript narrows
  // session.researchNotes to non-null for the rest of the component.
  if (session.researchNotes === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Assembling research from the source video…</p>
        <Skeleton className="h-24 w-full rounded-none" />
        <Skeleton className="h-32 w-full rounded-none" />
      </div>
    );
  }

  const notes = session.researchNotes;

  function commitFacts() {
    const updated = { ...notes, facts };
    onNotesChange(updated); // local sync in the orchestrator
    // buildResearch already persisted the rest; this is the one field the user can
    // edit after the fact.
    autosave(updateStageAction(session.id, { researchNotes: updated }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Source analysis</Label>
        {notes.sourceAnalysis ? (
          <div className="flex flex-col gap-2 border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="rounded-none">
                {notes.sourceAnalysis.hookType}
              </Badge>
              {notes.sourceAnalysis.formatTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="rounded-none">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground">{notes.sourceAnalysis.whyItWorked}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No analysis yet — analyze the source video from Video Detail first for richer research.</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Transcript excerpt</Label>
        <p className="line-clamp-4 border border-border p-3 text-sm text-muted-foreground">
          {notes.transcriptExcerpt ?? "No transcript available."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="research-facts" className="font-mono text-2xs tracking-wide text-faint uppercase">
          Facts &amp; notes
        </Label>
        <Textarea
          id="research-facts"
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          onBlur={commitFacts}
          placeholder="Add anything you want the Hook/Style/Script stages to know about…"
          rows={4}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Saved from your vault</Label>
        {vaultSavedPosts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {vaultSavedPosts.map((row) => {
              const tier = heatTier(row.item.outlierScore);
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 border border-border p-2 text-sm">
                  <Link href={`/feed/${row.item.videoId}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-medium">{row.item.channel.handle}</span>
                    {row.item.caption && <span className="text-muted-foreground"> — {row.item.caption}</span>}
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

      <div className="flex flex-col gap-1.5">
        <Label className="font-mono text-2xs tracking-wide text-faint uppercase">Similar tracked outliers</Label>
        {notes.similar.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {notes.similar.map((item) => {
              const tier = heatTier(item.outlierScore);
              return (
                <li key={item.videoId} className="flex items-center justify-between gap-2 border border-border p-2 text-sm">
                  <Link href={`/feed/${item.videoId}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-medium">{item.channelHandle}</span>
                    {item.caption && <span className="text-muted-foreground"> — {item.caption}</span>}
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
