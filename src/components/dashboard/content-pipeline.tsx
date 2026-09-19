import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { ContentArtifact, ArtifactKind } from "@/server/services/artifacts";

const KIND_LABEL: Record<ArtifactKind, string> = {
  angles: "Angles",
  outlier_library: "Outlier library",
  idea_bank: "Idea bank",
  monthly_plan: "Monthly plan",
  brief: "Brief",
};

/** "3d ago" / "5h ago" / "just now" from an ISO timestamp. */
function ago(iso: string, nowMs: number): string {
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * The "current content pipeline" section of the dashboard: what the reasoning agent has
 * actually produced and persisted through MCP. This is the counterpart to the read-side
 * outlier sections above it, and the reason the dashboard reflects the content machine
 * rather than generic app analytics. Each artifact row carries its provenance (which agent
 * authored it, when), because that is the honest thing to show for agent-authored output.
 */
export function ContentPipeline({
  artifacts,
  artifactTotal,
  scriptsDrafted,
  plannedCount,
  nowMs,
}: {
  artifacts: ContentArtifact[];
  artifactTotal: number;
  scriptsDrafted: number;
  plannedCount: number;
  nowMs: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content pipeline</CardTitle>
        <CardAction className="flex items-center gap-4 font-mono text-2xs text-muted-foreground" data-num>
          <span>{artifactTotal} artifacts</span>
          <span aria-hidden>·</span>
          <span>{scriptsDrafted} scripts</span>
          <span aria-hidden>·</span>
          <span>{plannedCount} planned</span>
        </CardAction>
      </CardHeader>

      <CardContent>
        {artifacts.length > 0 ? (
          <ItemGroup>
            {artifacts.map((a) => (
              <Item key={a.id} size="sm">
                <ItemMedia>
                  <Badge variant="outline" className="shrink-0">
                    {KIND_LABEL[a.kind] ?? a.kind}
                  </Badge>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{a.title}</ItemTitle>
                </ItemContent>
                <ItemActions className="gap-4">
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">by {a.agent}</span>
                  <span data-num className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {ago(a.updatedAt, nowMs)}
                  </span>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            No saved artifacts yet. Your agent writes angles, an outlier library, an idea bank, a monthly plan, and briefs
            here through MCP (crowsnest_save_artifact). Point Claude or Codex at the MCP server and ask it to build a plan.
          </p>
        )}
      </CardContent>

      <CardFooter>
        <Link href="/ideas" className="text-xs text-muted-foreground hover:text-foreground">
          Open ideas and scripts →
        </Link>
      </CardFooter>
    </Card>
  );
}
