"use client";

import { useState } from "react";
import { Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TemplateDetailDialog } from "@/components/vault/template-detail-dialog";
import type { VaultItemRow } from "@/server/queries/vault";

const SLOT_PATTERN = /(\{[a-zA-Z0-9_]+\})/g;

/** Renders `{topic}`-style slots in a template string as inline Badge chips
 * (DESIGN.md §2.6), everything else as plain text. Shared by the compact card's
 * preview and the full body in TemplateDetailDialog — imported there, not duplicated. */
export function renderTemplateText(text: string) {
  return text.split(SLOT_PATTERN).map((part, i) => {
    const match = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (!match) return <span key={i}>{part}</span>;
    return (
      <Badge key={i} variant="secondary" className="mx-0.5 align-middle">
        {match[1]}
      </Badge>
    );
  });
}

/** Vault Hooks/Styles tabs: a compact trigger card (title, two-line preview, tags,
 * source handle). The full body, Use in Remix, and Delete live in
 * TemplateDetailDialog, opened by clicking the card. */
export function TemplateCard({ item }: { item: VaultItemRow }) {
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
        aria-label={`Open ${item.type} ${item.title}`}
        className="cursor-pointer text-left hover:bg-card/80"
      >
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{item.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-2 text-sm text-muted-foreground">{renderTemplateText(item.templateText)}</p>

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {item.sourceVideo ? (
            <span className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground">
              <Play className="size-3" fill="currentColor" aria-hidden /> {item.sourceVideo.channelHandle}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Manual entry</span>
          )}
        </CardContent>
      </Card>

      <TemplateDetailDialog item={item} open={open} onOpenChange={setOpen} />
    </>
  );
}
