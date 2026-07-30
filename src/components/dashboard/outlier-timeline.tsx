import { scalePosition } from "@/components/video/median-baseline";
import type { FeedItem } from "@/server/queries/feed";
import { buildOutlierTimeline, TIMELINE_WINDOW_DAYS } from "./dashboard-chart-data";

/**
 * "28-day rolling timeline" (v1-scope.md P1 list). v1-scope.md's own cut ruling on
 * this chart names the reason its per-day color ramp was cut: "a day's bucket has no
 * single score, so a tier colour asserts a reading the data does not contain." That
 * argument is about COLOR, not height — bar height below still reflects the best score
 * posted that day (via the same `scalePosition` the median bar and the scatter use),
 * every bar renders in the one hue the ruling asks for.
 */
export function OutlierTimeline({ items }: { items: FeedItem[] }) {
  const { days, hitDays } = buildOutlierTimeline(items);
  const hasAny = days.some((d) => d.bestScore !== null);

  return (
    <div>
      <span data-lab className="font-mono text-2xs text-faint">
        Last {TIMELINE_WINDOW_DAYS} days · rolling window
      </span>
      {hasAny ? (
        <>
          <div
            role="img"
            aria-label={`Column chart, the last ${TIMELINE_WINDOW_DAYS} days. ${hitDays} days produced a post that beat its channel.`}
            className="mt-6 flex h-[100px] items-end gap-1"
          >
            {days.map((day) => (
              <span
                key={day.index}
                className="min-w-0 flex-1 bg-line-strong"
                style={{ height: day.bestScore !== null ? `${Math.max(4, scalePosition(day.bestScore) * 96)}px` : "1px" }}
              />
            ))}
          </div>
          <div className="mt-5 flex justify-between font-mono text-2xs tracking-wide text-faint">
            <span>{TIMELINE_WINDOW_DAYS - 1}d ago</span>
            <span data-num>{hitDays} days produced a post that beat its channel</span>
            <span>today</span>
          </div>
        </>
      ) : (
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          No scored post fell in the last {TIMELINE_WINDOW_DAYS} days.
        </p>
      )}
    </div>
  );
}
