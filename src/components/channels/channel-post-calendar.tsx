"use client";

/**
 * Three views over one channel's posts (DESIGN.md "mine" screen): a month calendar, a
 * flat post list, and a weekday rhythm chart. All three are computed client-side from
 * `ChannelDetail["videos"]`, which the page already fetches — no new query, no new
 * server action. This is presentation over data the page already holds.
 *
 * The prototype's month view also draws "planned" and "missed" cells, which need a
 * scheduling concept this app does not have. Those states are dropped rather than
 * faked; a day is either "published" (one or more posts) or "open" (none). A day more
 * than 3 days after the previous post gets a "dead air" tint — that gap is a real fact
 * derived from `postedAt`, not an invented state.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { formatCompact, formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChannelDetail } from "@/server/queries/channels";

type Post = ChannelDetail["videos"][number];

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DEAD_AIR_DAYS = 3;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

type DayCell = { date: Date; key: string; inMonth: boolean; posts: Post[]; deadAir: boolean };
type WeekRow = { cells: DayCell[]; reach: number; postCount: number };

// Everything below works in UTC-calendar-day space, not local time. `postedAt` is
// sliced straight from the stored ISO string (`dayKey`), so a grid cell built from a
// local-timezone `Date` and then round-tripped through `toISOString()` would land on
// the wrong day for any reader not on UTC. Building the grid with `Date.UTC` keeps the
// cell's date and a post's stored date in the same frame.
function buildMonth(monthStart: Date, postsByDay: Map<string, Post[]>, sortedPostDays: number[]): WeekRow[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = firstWeekday + daysInMonth;
  const weeks = Math.ceil(totalCells / 7);
  const gridStartMs = Date.UTC(year, month, 1 - firstWeekday);

  const rows: WeekRow[] = [];
  for (let w = 0; w < weeks; w++) {
    const cells: DayCell[] = [];
    let reach = 0;
    let postCount = 0;
    for (let d = 0; d < 7; d++) {
      const cellTime = gridStartMs + (w * 7 + d) * 86_400_000;
      const date = new Date(cellTime);
      const key = dayKey(date.toISOString());
      const posts = postsByDay.get(key) ?? [];
      let prevPostTime: number | null = null;
      for (const t of sortedPostDays) {
        if (t <= cellTime) prevPostTime = t;
        else break;
      }
      const deadAir = posts.length === 0 && prevPostTime !== null && (cellTime - prevPostTime) / 86_400_000 >= DEAD_AIR_DAYS;
      cells.push({ date, key, inMonth: date.getUTCMonth() === month, posts, deadAir });
      if (date.getUTCMonth() === month) {
        reach += posts.reduce((sum, p) => sum + (p.viewCount ?? 0), 0);
        postCount += posts.length;
      }
    }
    rows.push({ cells, reach, postCount });
  }
  return rows;
}

export function ChannelPostCalendar({ videos }: { videos: ChannelDetail["videos"] }) {
  const router = useRouter();
  const postsByDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const v of videos) {
      const key = dayKey(v.postedAt);
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    return map;
  }, [videos]);

  const sortedPostDays = useMemo(
    () => [...new Set(videos.map((v) => new Date(dayKey(v.postedAt)).getTime()))].sort((a, b) => a - b),
    [videos]
  );

  const latestPost = videos[0]; // already newest-first from getOutlierFeed(sort: "recent")
  const [cursor, setCursor] = useState(() => startOfMonth(latestPost ? new Date(latestPost.postedAt) : new Date()));

  const maxReach = Math.max(1, ...videos.map((v) => v.viewCount ?? 0));
  const rows = useMemo(() => buildMonth(cursor, postsByDay, sortedPostDays), [cursor, postsByDay, sortedPostDays]);
  const monthReach = rows.reduce((sum, r) => sum + r.reach, 0);
  const monthPosts = rows.reduce((sum, r) => sum + r.postCount, 0);

  const rhythm = useMemo(() => {
    const buckets = WEEKDAY_LABELS.map(() => ({ total: 0, n: 0 }));
    for (const v of videos) {
      if (v.viewCount === null) continue;
      const jsDay = new Date(v.postedAt).getUTCDay(); // 0=Sun, same UTC-day frame as dayKey
      const idx = (jsDay + 6) % 7; // 0=Mon
      buckets[idx].total += v.viewCount;
      buckets[idx].n += 1;
    }
    return buckets.map((b, i) => ({
      label: WEEKDAY_LABELS[i],
      avg: b.n > 0 ? Math.round(b.total / b.n) : null,
      n: b.n,
    }));
  }, [videos]);
  const maxRhythm = Math.max(1, ...rhythm.map((r) => r.avg ?? 0));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="Previous month"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            ‹
          </Button>
          <h3 className="min-w-[11ch] text-lg font-semibold tracking-tight">
            {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
          </h3>
          <Button
            aria-label="Next month"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            ›
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>
        <span className="font-mono text-2xs text-faint">
          {monthPosts} post{monthPosts === 1 ? "" : "s"} · <span data-num>{formatCompact(monthReach || null)}</span> views this
          month
        </span>
      </div>

      <Tabs defaultValue="month" className="mt-7">
        <TabsList className="rounded-full bg-popover p-1">
          <TabsTrigger value="month" className="rounded-full">
            Month
          </TabsTrigger>
          <TabsTrigger value="posts" className="rounded-full">
            Posts
          </TabsTrigger>
          <TabsTrigger value="metrics" className="rounded-full">
            Metrics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="month" className="mt-6">
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_88px] gap-2 border-b border-line-strong pb-3 font-mono text-2xs text-faint">
                {WEEKDAY_LABELS.map((d) => (
                  <span key={d} data-lab>
                    {d}
                  </span>
                ))}
                <span data-lab className="text-right">
                  Week
                </span>
              </div>
              {rows.map((row, i) => (
                <div key={i} className="mt-2 grid grid-cols-[repeat(7,minmax(0,1fr))_88px] gap-2">
                  {row.cells.map((cell) => {
                    const dayReach = cell.posts.reduce((s, p) => s + (p.viewCount ?? 0), 0);
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        title={cell.posts.map((p) => p.caption ?? "untitled post").join(", ") || undefined}
                        onClick={() => cell.posts[0] && router.push(`/feed/${cell.posts[0].videoId}`)}
                        disabled={cell.posts.length === 0}
                        className={cn(
                          "flex min-h-[76px] flex-col gap-1.5 border border-border p-2 text-left",
                          !cell.inMonth && "opacity-40",
                          cell.posts.length > 0 && "border-line-strong bg-card",
                          cell.deadAir && cell.inMonth && "bg-destructive/5",
                          cell.posts.length === 0 && "cursor-default"
                        )}
                      >
                        <span data-num className="font-mono text-2xs text-faint">
                          {cell.date.getUTCDate()}
                        </span>
                        {cell.posts.length > 0 && (
                          <span data-num className="font-mono text-sm text-foreground">
                            {formatCompact(dayReach)}
                          </span>
                        )}
                        {cell.posts[0] && (
                          <span className="line-clamp-2 text-2xs text-muted-foreground">
                            {cell.posts[0].caption ?? "Untitled post"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <div className="flex flex-col items-end justify-center gap-1.5 border-l border-border pl-2">
                    <span data-num className="font-mono text-sm">
                      {row.reach > 0 ? formatCompact(row.reach) : "—"}
                    </span>
                    <span className="font-mono text-2xs text-faint">
                      {row.postCount} post{row.postCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-2xs text-faint">
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-3 border-t-2 border-line-strong bg-card" /> published · number is views
            </span>
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-3 border border-border bg-destructive/5" /> 3+ days dead air
            </span>
            <span className="flex items-center gap-2">
              <i aria-hidden className="size-3 border border-border" /> open
            </span>
          </div>
        </TabsContent>

        <TabsContent value="posts" className="mt-6">
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts synced yet.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[minmax(0,1fr)_140px_88px_110px] gap-4 border-b border-line-strong pb-3 font-mono text-2xs text-faint">
                <span data-lab>Post</span>
                <span data-lab className="text-right">
                  Views
                </span>
                <span data-lab className="text-right">
                  Length
                </span>
                <span data-lab className="text-right">
                  Published
                </span>
              </div>
              {videos.map((p) => (
                <div
                  key={p.videoId}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/feed/${p.videoId}`)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/feed/${p.videoId}`)}
                  className="grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_140px_88px_110px] items-center gap-4 border-b border-border py-2"
                >
                  <span className="truncate text-sm">{p.caption ?? "Untitled post"}</span>
                  <div className="flex items-center justify-end gap-3">
                    <div className="h-1.5 flex-1 bg-popover">
                      <div
                        className="h-1.5 bg-muted-foreground"
                        style={{ width: `${p.viewCount === null ? 0 : Math.max(2, (p.viewCount / maxReach) * 100)}%` }}
                      />
                    </div>
                    <span data-num className="w-14 shrink-0 text-right font-mono text-sm">
                      {formatCompact(p.viewCount)}
                    </span>
                  </div>
                  <span data-num className="text-right font-mono text-2xs text-faint">
                    {p.durationSec === null ? "—" : formatDuration(p.durationSec)}
                  </span>
                  <span className="text-right font-mono text-2xs text-faint">{relativeTime(p.postedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="mt-6">
          <span data-lab className="font-mono text-2xs text-faint">
            Average views by weekday
          </span>
          <div className="mt-6 grid h-[180px] grid-cols-7 items-end gap-2">
            {rhythm.map((r) => (
              <div key={r.label} className="flex h-full flex-col justify-end gap-2.5">
                <span data-num className="font-mono text-xs text-muted-foreground">
                  {r.avg === null ? "—" : formatCompact(r.avg)}
                </span>
                <div
                  className="bg-muted-foreground/40"
                  style={{ height: `${r.avg === null ? 2 : Math.max(4, (r.avg / maxRhythm) * 100)}%` }}
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
            Every bar is an average of {videos.length} post{videos.length === 1 ? "" : "s"} total, spread across seven
            buckets — most days here are one or two posts. Read this as a reading, not a rhythm, until each weekday
            carries more than a couple.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
