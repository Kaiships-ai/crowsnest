"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMultiplier } from "@/lib/format";
import { buildResearchAction, updateStageAction } from "@/server/actions/remix-actions";
import type { ResearchNotes } from "@/server/services/remix";
import type { RemixSessionRow } from "@/server/services/remix";

/** DESIGN.md §2.5 stage ②: auto-assembled on entry if empty (source analysis +
 * transcript + top-5 similar), editable facts box, similar-outliers list read-only.
 * buildResearch makes zero Claude calls, so this auto-build works in keyless mode. */
export function StageResearch({
  session,
  onNotesChange,
}: {
  session: RemixSessionRow;
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
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const notes = session.researchNotes;

  function commitFacts() {
    const updated = { ...notes, facts };
    onNotesChange(updated); // local sync in the orchestrator
    void updateStageAction(session.id, { researchNotes: updated }); // buildResearch already
    // persisted the rest; this is the one field the user can edit after the fact.
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label>Source analysis</Label>
        {notes.sourceAnalysis ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{notes.sourceAnalysis.hookType}</Badge>
              {notes.sourceAnalysis.formatTags.map((tag) => (
                <Badge key={tag} variant="secondary">
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
        <Label>Transcript excerpt</Label>
        <p className="line-clamp-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">
          {notes.transcriptExcerpt ?? "No transcript available."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="research-facts">Facts &amp; notes</Label>
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
        <Label>Similar tracked outliers</Label>
        {notes.similar.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {notes.similar.map((item) => (
              <li key={item.videoId} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <Link href={`/feed/${item.videoId}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="font-medium">{item.channelHandle}</span>
                  {item.caption && <span className="text-muted-foreground"> — {item.caption}</span>}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatMultiplier(item.outlierScore)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Analyze more videos to see patterns here.</p>
        )}
      </div>
    </div>
  );
}
