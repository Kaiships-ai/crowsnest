import { Badge } from "@/components/ui/badge";
import { formatCompact } from "@/lib/format";

/**
 * Likes, comments and the engagement rate, one badge each. Kept as a single component
 * (rather than inlined at the call site) because it also derives the engagement rate,
 * which nothing else needs.
 */
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

  const stats: { label: string; value: string }[] = [
    { label: "likes", value: formatCompact(likeCount) },
    { label: "comments", value: formatCompact(commentCount) },
    // A missing value is a dash, never a zero — formatCompact/toFixed already give
    // that for the two counts above; engagement needs its own null check since it's
    // computed here rather than read straight off a column.
    { label: "engagement", value: engagement !== null ? `${engagement.toFixed(1)}%` : "—" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {stats.map((s) => (
        <Badge key={s.label} variant="secondary">
          <span data-num>{s.value}</span>
          {s.label}
        </Badge>
      ))}
    </div>
  );
}
