import Link from "next/link";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { formatCompact } from "@/lib/format";

export interface ReelPickerItem {
  ownPostId: string;
  postedAt: string;
  views: number | null;
  thumbnailUrl: string | null;
  caption: string | null;
}

/** One link per reel; the selection lives in ?reel= so a reload keeps it. */
export function ReelPicker({ reels, selectedId }: { reels: ReelPickerItem[]; selectedId: string | null }) {
  if (reels.length === 0) {
    return <p className="text-sm text-muted-foreground">No reels measured yet. Every post you have is listed under Posts below.</p>;
  }
  return (
    <ItemGroup className="max-h-[520px] overflow-y-auto *:shrink-0">
      {reels.map((r) => {
        const selected = r.ownPostId === selectedId;
        return (
          <Item
            key={r.ownPostId}
            variant={selected ? "muted" : "default"}
            aria-current={selected ? "true" : undefined}
            data-testid="reels-picker-item"
            data-id={r.ownPostId}
            render={<Link href={`/?tab=reels&reel=${encodeURIComponent(r.ownPostId)}`} scroll={false} />}
          >
            <ItemMedia variant="image">
              {/* eslint-disable-next-line @next/next/no-img-element -- Instagram CDN link, not an app asset */}
              {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="block truncate">{r.caption ?? "Untitled reel"}</ItemTitle>
              <ItemDescription className="font-mono text-2xs">
                {new Date(r.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · <span data-num>{formatCompact(r.views)}</span> views
              </ItemDescription>
            </ItemContent>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
