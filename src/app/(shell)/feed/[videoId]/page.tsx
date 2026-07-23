import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Video Detail</h1>
        <p className="text-sm text-muted-foreground">
          Full breakdown of a single outlier — player, transcript, hook
          structure, and why it worked.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Video {videoId}</CardTitle>
          <CardDescription>
            Phase 2/3 builds this — see docs/PLAN.md
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Player placeholder, metric chips, and the Transcript / Hook &amp;
          Structure / Why it worked tabs land here.
        </CardContent>
      </Card>
    </div>
  );
}
