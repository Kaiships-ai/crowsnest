import { Eye, Heart, MessageCircle, Percent } from "lucide-react";

import { formatCompact } from "@/lib/format";

export function MetricChips({
  viewCount,
  likeCount,
  commentCount,
}: {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}) {
  const engagement =
    viewCount && viewCount > 0 && likeCount !== null && commentCount !== null
      ? ((likeCount + commentCount) / viewCount) * 100
      : null;

  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <Eye className="size-4 shrink-0" aria-hidden />
        {formatCompact(viewCount)} views
      </span>
      <span className="inline-flex items-center gap-2">
        <Heart className="size-4 shrink-0" aria-hidden />
        {formatCompact(likeCount)} likes
      </span>
      <span className="inline-flex items-center gap-2">
        <MessageCircle className="size-4 shrink-0" aria-hidden />
        {formatCompact(commentCount)} comments
      </span>
      <span className="inline-flex items-center gap-2">
        <Percent className="size-4 shrink-0" aria-hidden />
        {engagement !== null ? `${engagement.toFixed(1)}% engagement` : "— engagement"}
      </span>
    </div>
  );
}
