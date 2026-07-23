import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function RemixStudioPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Remix Studio</h1>
        <p className="text-sm text-muted-foreground">
          Staged pipeline — Prompt, Research, Hook, Style, and Script — for
          turning an outlier into your own draft.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Remixing video {videoId}</CardTitle>
          <CardDescription>
            Phase 2/3 builds this — see docs/PLAN.md
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The persistent source rail and the 5-stage stepper land here.
        </CardContent>
      </Card>
    </div>
  );
}
