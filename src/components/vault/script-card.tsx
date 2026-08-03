"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScriptDetailDialog } from "@/components/vault/script-detail-dialog";
import type { ScriptRow } from "@/server/queries/vault";

function firstLine(content: string): string {
  return content.split("\n")[0] ?? "";
}

/** Vault Scripts tab: a compact trigger card (title, status, source channel, and a
 * two-line preview). The full body, hook/style badges, source link, and the Create
 * Prompt action live in ScriptDetailDialog, opened by clicking the card. */
export function ScriptCard({ script }: { script: ScriptRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={`Open script ${script.title}`}
        className="cursor-pointer text-left hover:bg-card/80"
      >
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold">{script.title}</h3>
            <Badge variant={script.status === "final" ? "secondary" : "outline"}>{script.status}</Badge>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{firstLine(script.content)}</p>
          {script.sourceVideo && (
            <span className="w-fit text-xs text-muted-foreground">{script.sourceVideo.channelHandle}</span>
          )}
        </CardContent>
      </Card>

      <ScriptDetailDialog script={script} open={open} onOpenChange={setOpen} />
    </>
  );
}
