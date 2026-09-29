import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact, formatEngagementRate, relativeTime } from "@/lib/format";
import type { InsightItem, ShapedReelInsights, ViewsPoint } from "@/server/services/reel-insights";
import { ReelViewsOverTime } from "./reel-views-over-time";

const UNAVAILABLE = ["How long people watched", "When people liked your reel", "Top sources of views"];

function itemValue(i: InsightItem): string {
  if (i.value === null) return "—";
  return i.unit === "seconds" ? `${i.value.toFixed(1)}s` : formatCompact(i.value);
}

// ponytail: reels_skip_rate is taken to be a percentage (02 section 9, unverified live).
function skipRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

const NOT_REPORTED = "not reported for reels";

function Row({ testId, label, value, badge, notReported }: { testId: string; label: string; value: string; badge?: string; notReported?: boolean }) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">
        {label} {badge && <Badge variant="outline">{badge}</Badge>}
        {notReported && <span data-testid="reels-not-reported" className="font-mono text-2xs"> · {NOT_REPORTED}</span>}
      </span>
      <span data-num className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

/** One reel's insights in the Instagram app's block order; a dash wherever the API gave nothing. */
export function ReelInsightPanel({ insights, points }: { insights: ShapedReelInsights; points: ViewsPoint[] }) {
  const measured = `Measured ${relativeTime(insights.measuredAt)}`;
  return (
    <div className="flex flex-col gap-6">
      <p data-testid="reels-measured-at" className="font-mono text-2xs text-muted-foreground">
        {measured}. Instagram&apos;s numbers can lag up to 48 hours behind the app.
      </p>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {insights.summary.map((i) => (
          <div key={i.label} data-testid="reels-summary-tile" className="flex flex-col gap-1">
            <span data-num className="font-mono text-2xl text-foreground">{itemValue(i)}</span>
            <span className="text-sm text-muted-foreground">{i.label}</span>
            {i.notReported && <span data-testid="reels-not-reported" className="font-mono text-2xs text-muted-foreground">{NOT_REPORTED}</span>}
          </div>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Interactions</CardTitle><CardDescription>{measured}</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {insights.interactions.map((i) => (
            <div key={i.label} data-testid="reels-interaction" className="flex flex-col gap-1">
              <span data-num className="font-mono text-xs text-foreground">{itemValue(i)}</span>
              <span className="font-mono text-2xs text-muted-foreground">{i.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What impacts your views</CardTitle><CardDescription>Each rate is a share of the people who saw the reel. {measured}</CardDescription></CardHeader>
        <CardContent>
          {insights.impact.map((r) => (
            <Row key={r.label} testId="reels-impact-row" label={r.label} value={r.estimated ? skipRate(r.value) : formatEngagementRate(r.value)} badge={r.estimated ? "estimated" : undefined} />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Actions after viewing</CardTitle><CardDescription>{measured}</CardDescription></CardHeader>
        <CardContent>
          {insights.actions.map((i) => <Row key={i.label} testId="reels-action-row" label={i.label} value={itemValue(i)} notReported={i.notReported} />)}
        </CardContent>
      </Card>
      <ReelViewsOverTime points={points} />
      <Card>
        <CardHeader><CardTitle>Not available from the Instagram API</CardTitle></CardHeader>
        <CardContent>
          {UNAVAILABLE.map((label) => (
            <Row key={label} testId="reels-unavailable" label={label} value="The Instagram API does not provide this" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
