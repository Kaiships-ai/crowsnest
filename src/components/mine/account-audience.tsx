import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEngagementRate, relativeTime } from "@/lib/format";
import type { AccountBreakdowns, BreakdownEntry } from "@/server/queries/own-channel";

const WHOLE_ACCOUNT = "Whole account, not this reel";
const SPLIT_LABEL: Record<string, string> = { FOLLOWER: "Followers", NON_FOLLOWER: "Non-followers" };
const DIMENSIONS = [
  { id: "age", label: "Age", testId: "reels-audience-tab-age" },
  { id: "country", label: "Country", testId: "reels-audience-tab-country" },
  { id: "gender", label: "Gender", testId: "reels-audience-tab-gender" },
] as const;
const THRESHOLD = "Instagram shares audience details only once an account has 100 or more engagements this month, so there is nothing to show yet.";
/** ponytail: matched on Meta's "Not enough ..." wording, not a documented code (code 10
 *  also means a permission refusal); any other error keeps the stored rows. */
const isThresholdRefusal = (error: string | null) => error !== null && /not enough/i.test(error);

function Shares({ entries, label = (k: string) => k }: { entries: BreakdownEntry[]; label?: (k: string) => string }) {
  const total = entries.reduce((a, b) => a + b.value, 0);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Not measured yet.</p>;
  return (
    <div className="flex flex-col">
      {entries.slice(0, 10).map((e) => (
        <div key={e.key} className="flex justify-between border-b border-border py-2 last:border-0">
          <span className="text-sm text-muted-foreground">{label(e.key)}</span>
          <span data-num className="font-mono text-xs">{formatEngagementRate(total > 0 ? e.value / total : null)}</span>
        </div>
      ))}
    </div>
  );
}

/** Account-level numbers the API does not give per reel, always labelled as whole-account
 *  so none reads as this reel's. Country shows the API's top results only. */
export function AccountAudience({ data }: { data: AccountBreakdowns }) {
  const belowThreshold = isThresholdRefusal(data.audienceError);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card data-testid="reels-follower-split">
        <CardHeader>
          <CardTitle>Followers vs non-followers</CardTitle>
          <CardDescription>{data.followerSplitAt ? `Views, measured ${relativeTime(data.followerSplitAt)}` : "Views"}</CardDescription>
          <CardAction><Badge variant="outline">{WHOLE_ACCOUNT}</Badge></CardAction>
        </CardHeader>
        <CardContent><Shares entries={data.followerSplit} label={(k) => SPLIT_LABEL[k] ?? k} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Audience details</CardTitle>
          <CardDescription>{data.audienceAt ? `Engaged audience this month, measured ${relativeTime(data.audienceAt)}` : "Engaged audience this month"}</CardDescription>
          <CardAction><Badge variant="outline">{WHOLE_ACCOUNT}</Badge></CardAction>
        </CardHeader>
        <CardContent>
          {data.audienceError && !belowThreshold && <p className="mb-3 text-xs text-muted-foreground">Last refresh failed, showing the previous numbers.</p>}
          <Tabs defaultValue="age">
            <TabsList>
              {DIMENSIONS.map((d) => (
                <TabsTrigger key={d.id} value={d.id} data-testid={d.testId}>{d.label}</TabsTrigger>
              ))}
            </TabsList>
            {DIMENSIONS.map((d) => (
              <TabsContent key={d.id} value={d.id} className="pt-4">
                {belowThreshold ? <p className="text-sm text-muted-foreground">{THRESHOLD}</p> : <Shares entries={data.audience[d.id]} />}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
