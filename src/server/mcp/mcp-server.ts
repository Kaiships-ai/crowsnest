import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";
import { getVideoDetail } from "@/server/queries/video";
import { getStudioBrief } from "@/server/queries/studio";
import { getScripts } from "@/server/queries/vault";
import { getPlannedPosts } from "@/server/queries/planned-posts";

/**
 * The Crowsnest MCP server. Read tools only for now (the generate/remix tools are added
 * separately). Every tool is a thin wrapper over an existing query function, so the MCP
 * surface and the dashboard read the same data through the same code. Mounted inside the
 * app's own server process (see server.ts), so it shares the one SQLite connection and
 * never becomes a second writer.
 */

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "crowsnest", version: "0.1.0" },
    { instructions: "Read Crowsnest data: the outlier feed, a video with its analysis, a studio brief, saved scripts, and planned posts. Use crowsnest_feed to browse outliers, then crowsnest_video for one video's detail." }
  );

  server.registerTool(
    "crowsnest_feed",
    {
      title: "Outlier feed",
      description: "The outlier feed: top videos from tracked channels, ranked. Returns the items and the total match count. All filters are optional.",
      inputSchema: {
        minScore: z.number().optional().describe("Minimum outlier score, e.g. 5 for 5x."),
        minViews: z.number().optional().describe("Minimum view count."),
        sinceDays: z.number().optional().describe("Only videos posted within this many days."),
        followerBand: z.enum(["nano", "mid", "macro"]).optional().describe("Channel size: nano 0-10k, mid 100k-1M, macro 1M+."),
        query: z.string().optional().describe("Free text search over caption and channel."),
        analyzed: z.enum(["yes", "no"]).optional().describe("Only videos that have (yes) or lack (no) an analysis."),
        sort: z.enum(["score", "recent", "views"]).optional().describe("Sort order, default score."),
        limit: z.number().optional().describe("Max items, default 24."),
        offset: z.number().optional().describe("Skip this many, for paging."),
      },
    },
    async (args) => {
      const filters: FeedFilters = {
        minScore: args.minScore,
        minViews: args.minViews,
        sinceDays: args.sinceDays,
        followerBand: args.followerBand,
        query: args.query,
        analyzed: args.analyzed,
        sort: (args.sort ?? "score") as FeedSort,
        limit: args.limit ?? 24,
        offset: args.offset ?? 0,
      };
      const { items, total } = await getOutlierFeed(filters);
      return text({ total, count: items.length, items });
    }
  );

  server.registerTool(
    "crowsnest_video",
    {
      title: "Video detail",
      description: "One video with its analysis, transcript, and metrics, by video id. Returns null when the id is unknown.",
      inputSchema: { videoId: z.string().describe("The video id, from crowsnest_feed items.") },
    },
    async (args) => {
      const detail = await getVideoDetail(args.videoId);
      if (!detail) return text({ error: "not found", videoId: args.videoId });
      return text(detail);
    }
  );

  server.registerTool(
    "crowsnest_brief",
    {
      title: "Studio brief",
      description: "The studio brief for a planned post: its title, the source video, the remix hook and beats, the layout, and the score. By planned post id. Returns null when unknown.",
      inputSchema: { postId: z.string().describe("The planned post id, from crowsnest_plans.") },
    },
    async (args) => {
      const brief = await getStudioBrief(args.postId);
      if (!brief) return text({ error: "not found", postId: args.postId });
      return text(brief);
    }
  );

  server.registerTool(
    "crowsnest_scripts",
    {
      title: "Saved scripts",
      description: "Every saved script, newest first. A script is the text a remix produced.",
      inputSchema: {},
    },
    async () => text(await getScripts())
  );

  server.registerTool(
    "crowsnest_plans",
    {
      title: "Planned posts",
      description: "Planned posts (dated intentions to publish on the own channel), optionally within a date range.",
      inputSchema: {
        from: z.string().optional().describe("Start date YYYY-MM-DD, inclusive."),
        to: z.string().optional().describe("End date YYYY-MM-DD, inclusive."),
      },
    },
    async (args) => {
      const range = args.from && args.to ? { from: args.from, to: args.to } : undefined;
      return text(await getPlannedPosts(range));
    }
  );

  return server;
}
