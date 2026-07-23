import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ChannelsPage() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Channels</h1>
        <p className="text-sm text-muted-foreground">
          Every tracked channel, grouped into Fleets, with follower and
          median-view stats.
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
          The Fleet rail and channel table land here.
        </CardContent>
      </Card>
    </div>
  );
}
