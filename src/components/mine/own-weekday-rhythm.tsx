/**
 * "Metrics" view (v1-scope.md §1: the third of the three my-channel views, alongside
 * the calendar and the post list). Average reach by weekday, same shape as the tracked-
 * channel calendar's rhythm tab (`channel-post-calendar.tsx`) but built on Insights
 * reach rather than a view count, and carrying its sample size per weekday like every
 * other own-channel figure on this screen.
 */

import type { OwnPostRow } from "@/server/queries/own-channel";

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

export function OwnWeekdayRhythm({ posts }: { posts: OwnPostRow[] }) {
  const measured = posts.filter((p) => p.reach !== null);

  const buckets = WEEKDAY_LABELS.map(() => ({ total: 0, n: 0 }));
  for (const p of measured) {
    const jsDay = new Date(p.postedAt).getUTCDay(); // 0=Sun
    const idx = (jsDay + 6) % 7; // 0=Mon
    buckets[idx].total += p.reach as number;
    buckets[idx].n += 1;
  }
  const rhythm = buckets.map((b, i) => ({
    label: WEEKDAY_LABELS[i],
    avg: b.n > 0 ? Math.round(b.total / b.n) : null,
    n: b.n,
  }));
  const maxAvg = Math.max(1, ...rhythm.map((r) => r.avg ?? 0));

  if (measured.length === 0) {
    return <p className="text-sm text-muted-foreground">No measured posts yet to read a weekday rhythm from.</p>;
  }

  return (
    <div>
      <span data-lab className="font-mono text-2xs text-faint">
        Average reach by weekday
      </span>
      <div className="mt-6 grid h-[180px] grid-cols-7 items-end gap-2">
        {rhythm.map((r) => (
          <div key={r.label} className="flex h-full flex-col justify-end gap-2.5">
            <span data-num className="font-mono text-xs text-muted-foreground">
              {r.avg === null ? "—" : r.avg.toLocaleString("en-US")}
            </span>
            <div
              className="bg-muted-foreground/40"
              style={{ height: `${r.avg === null ? 2 : Math.max(6, (r.avg / maxAvg) * 100)}%` }}
            />
            <span data-lab className="font-mono text-2xs text-faint">
              {r.label}
            </span>
            <span data-num className="font-mono text-2xs text-faint">
              n={r.n}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-7 max-w-[60ch] text-sm text-muted-foreground">
        Every bar is an average across {measured.length} measured post{measured.length === 1 ? "" : "s"} total,
        spread over seven buckets, and most days here carry one post or none. Read this as a reading, not a
        rhythm, until each weekday carries more than a couple.
      </p>
    </div>
  );
}
