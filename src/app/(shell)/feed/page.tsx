import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function FeedPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Outlier Feed</h1>
        <p className="text-sm text-muted-foreground">
          Every tracked channel&rsquo;s outlier reels, filterable by Fleet,
          platform, score, and more.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Phase 2/3 builds this — see docs/PLAN.md
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Filter bar and the responsive outlier card grid land here.
        </CardContent>
      </Card>
    </div>
  );
}
