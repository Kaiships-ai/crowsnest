import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Channel Detail</h1>
        <p className="text-sm text-muted-foreground">
          Stats, outlier history, and reels for a single tracked channel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channel {channelId}</CardTitle>
          <CardDescription>
            Phase 2/3 builds this — see docs/PLAN.md
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Stat tiles, the outlier history chart, and the Recent Reels /
          Outliers Only / In Vault tabs land here.
        </CardContent>
      </Card>
    </div>
  );
}
