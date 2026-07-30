/**
 * Reach by post (v1-scope.md §1 "My channel": "Reach by post bars — the core own-
 * channel read"). Every value is `OwnPostRow.reach`, straight from Instagram Insights —
 * never `videos.view_count`, never a view count relabeled as reach (CONTEXT.md:
 * "Insight: a metric that exists only for an Owned channel: reach, saves, shares...").
 *
 * Kai's own channel has ~5 followers and posts that reach ~9 people (WAVE2-BRIEF: "tiny
 * numbers need dignity... a reach of 9 must not look broken and must not be dressed up
 * as a trend"). Two rules follow from that:
 *   - every bar gets a visible floor height, so a 9 next to a 400 is still a bar and not
 *     a sliver that reads as a rendering bug;
 *   - the floor is purely visual (a max() on the CSS height), never a log scale or a
 *     value transform — the printed numeral above each bar is always the real number,
 *     so nothing here makes 9 look bigger than it is.
 * A post with no measured reach gets no bar at all (an empty column, dashed value) and
 * is counted separately — a missing measurement rendered as a zero-height bar would be
 * indistinguishable from a real, tiny reach of zero.
 */

import { formatDuration, relativeTime } from "@/lib/format";
import type { OwnPostRow } from "@/server/queries/own-channel";

const MIN_BAR_PCT = 6;

export function ReachByPostBars({ posts }: { posts: OwnPostRow[] }) {
  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">No posts synced from Instagram yet.</p>;
  }

  // Oldest first, left to right — same reading order as the calendar and the prototype.
  const chronological = [...posts].reverse();
  const measured = chronological.filter((p) => p.reach !== null);
  const missing = chronological.length - measured.length;
  const maxReach = Math.max(1, ...measured.map((p) => p.reach as number));

  return (
    <div>
      <p className="font-mono text-2xs tracking-wide text-faint">
        REACH BY POST · ALL {chronological.length} POST{chronological.length === 1 ? "" : "S"}
      </p>
      <div role="img" aria-label={`Reach for ${measured.length} of ${chronological.length} posts`} className="mt-6 flex h-[150px] items-end gap-3.5">
        {chronological.map((p) => {
          const hasReach = p.reach !== null;
          const pct = hasReach ? Math.max(MIN_BAR_PCT, ((p.reach as number) / maxReach) * 100) : 0;
          return (
            <div key={p.ownPostId} className="flex h-full flex-1 flex-col justify-end gap-2.5" title={p.caption ?? "Untitled post"}>
              <span data-num className="font-mono text-sm text-foreground">
                {hasReach ? (p.reach as number).toLocaleString("en-US") : "—"}
              </span>
              {hasReach ? (
                <div className="bg-muted-foreground" style={{ height: `${pct}%` }} />
              ) : (
                <div className="h-[4px] border-t border-dashed border-border" />
              )}
              <span className="font-mono text-2xs text-faint">{relativeTime(p.postedAt).replace(" ago", "")}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-5 max-w-[52ch] text-[15px] text-muted-foreground">
        {missing > 0
          ? `${measured.length} of ${chronological.length} posts have a measured reach. ${missing} ${missing === 1 ? "has" : "have"} none yet.`
          : `Every one of these ${chronological.length} posts has a measured reach.`}
      </p>
    </div>
  );
}

/** Flat post list — title, reach, length, published (v1-scope.md §1: "Post list:
 *  title, reach, length, published"). Kept in the same file as the bars since both read
 *  the identical `OwnPostRow[]` and neither needs its own data shape. */
export function OwnPostList({ posts }: { posts: OwnPostRow[] }) {
  if (posts.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No posts synced from Instagram yet.</p>;
  }
  const maxReach = Math.max(1, ...posts.map((p) => p.reach ?? 0));

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_140px_88px_110px] gap-4 border-b border-line-strong pb-3 font-mono text-2xs text-faint">
        <span data-lab>Post</span>
        <span data-lab className="text-right">
          Reach
        </span>
        <span data-lab className="text-right">
          Length
        </span>
        <span data-lab className="text-right">
          Published
        </span>
      </div>
      {posts.map((p) => (
        <a
          key={p.ownPostId}
          href={p.permalink}
          target="_blank"
          rel="noreferrer"
          className="grid min-h-14 grid-cols-[minmax(0,1fr)_140px_88px_110px] items-center gap-4 border-b border-border py-2 hover:bg-card"
        >
          <span className="truncate text-sm">{p.caption ?? "Untitled post"}</span>
          <div className="flex items-center justify-end gap-3">
            <div className="h-1.5 flex-1 bg-popover">
              <div
                className="h-1.5 bg-muted-foreground"
                style={{ width: p.reach === null ? 0 : `${Math.max(2, (p.reach / maxReach) * 100)}%` }}
              />
            </div>
            <span data-num className="w-14 shrink-0 text-right font-mono text-sm">
              {p.reach === null ? "—" : p.reach.toLocaleString("en-US")}
            </span>
          </div>
          <span data-num className="text-right font-mono text-2xs text-faint">
            {p.durationSec === null ? "—" : formatDuration(p.durationSec)}
          </span>
          <span className="text-right font-mono text-2xs text-faint">{relativeTime(p.postedAt)}</span>
        </a>
      ))}
    </div>
  );
}
