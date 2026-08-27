import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";
import { getVideoDetail } from "@/server/queries/video";
import { getStudioBrief } from "@/server/queries/studio";
import { getScripts } from "@/server/queries/vault";
import { getPlannedPosts } from "@/server/queries/planned-posts";
import {
  getOrCreateSession,
  getRemixSession,
  updateStage,
  buildResearch,
  generateHooks,
  generateOutline,
  generateVariants,
  saveScript,
  finishRemix,
} from "@/server/services/remix";

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

  // Remix, exposed one tool per stage so a caller can steer each step. Every tool calls
  // the same service functions the studio uses. The generate tools (hooks, outline,
  // variants) need the LLM proxy; the others do not. Stage progression on the session is
  // left to the service functions (finish sets the stage); these tools do not manage the
  // stepper, since that only affects how the dashboard renders the session.

  server.registerTool(
    "crowsnest_remix_session",
    {
      title: "Get or create a remix session",
      description: "Get the remix session for a source video, or create one. There is one session per video. Returns the session state.",
      inputSchema: { videoId: z.string().describe("The source video id, from crowsnest_feed.") },
    },
    async (args) => text(await getOrCreateSession(args.videoId))
  );

  server.registerTool(
    "crowsnest_remix_state",
    {
      title: "Remix session state",
      description: "The current state of a remix session: topic, chosen hook, outline, variants, chosen variant. Returns null when unknown.",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => text(await getRemixSession(args.sessionId))
  );

  server.registerTool(
    "crowsnest_remix_set_prompt",
    {
      title: "Set the remix prompt",
      description: "Set the topic, niche, and target length on a session. All optional; only the given fields change.",
      inputSchema: {
        sessionId: z.string(),
        topic: z.string().optional(),
        niche: z.string().optional(),
        targetLengthSec: z.number().optional(),
      },
    },
    async (args) => {
      const patch: { topic?: string; niche?: string; targetLengthSec?: number } = {};
      if (args.topic !== undefined) patch.topic = args.topic;
      if (args.niche !== undefined) patch.niche = args.niche;
      if (args.targetLengthSec !== undefined) patch.targetLengthSec = args.targetLengthSec;
      await updateStage(args.sessionId, patch);
      return text(await getRemixSession(args.sessionId));
    }
  );

  server.registerTool(
    "crowsnest_remix_research",
    {
      title: "Build research",
      description: "Assemble the research notes for a session from the source analysis, transcript, and similar outliers. No model call, so this works with the proxy down.",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => text(await buildResearch(args.sessionId))
  );

  server.registerTool(
    "crowsnest_remix_hooks",
    {
      title: "Generate hooks",
      description: "Generate hook options for a session. Needs the LLM proxy. Optionally seed from a vault hook, or steer with a note.",
      inputSchema: {
        sessionId: z.string(),
        vaultItemId: z.string().optional().describe("A vault hook item id to seed from."),
        steer: z.string().optional().describe("A note to steer the generation, e.g. punchier."),
      },
    },
    async (args) => text({ hooks: await generateHooks(args.sessionId, { vaultItemId: args.vaultItemId, steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_choose_hook",
    {
      title: "Choose a hook",
      description: "Set the chosen hook on a session, by its text (one of the generated hooks, or your own).",
      inputSchema: { sessionId: z.string(), hook: z.string() },
    },
    async (args) => {
      await updateStage(args.sessionId, { chosenHook: args.hook });
      return text({ ok: true, chosenHook: args.hook });
    }
  );

  server.registerTool(
    "crowsnest_remix_style",
    {
      title: "Choose a style",
      description: "Set the style vault item on a session, or clear it (pass no styleVaultItemId) to use the source video's own structure.",
      inputSchema: { sessionId: z.string(), styleVaultItemId: z.string().optional() },
    },
    async (args) => {
      await updateStage(args.sessionId, { styleVaultItemId: args.styleVaultItemId ?? null });
      return text({ ok: true, styleVaultItemId: args.styleVaultItemId ?? null });
    }
  );

  server.registerTool(
    "crowsnest_remix_outline",
    {
      title: "Generate outline",
      description: "Generate the beat outline for a session from its chosen hook and style. Needs the LLM proxy. Steer with a note.",
      inputSchema: { sessionId: z.string(), steer: z.string().optional() },
    },
    async (args) => text(await generateOutline(args.sessionId, { steer: args.steer }))
  );

  server.registerTool(
    "crowsnest_remix_variants",
    {
      title: "Generate variants",
      description: "Generate script variants (three by default) for a session. Needs the LLM proxy. A failed variant is returned as an error at its slot. Steer with a note.",
      inputSchema: { sessionId: z.string(), steer: z.string().optional() },
    },
    async (args) => text({ variants: await generateVariants(args.sessionId, { steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_regenerate_variant",
    {
      title: "Regenerate one variant",
      description: "Regenerate a single variant slot by index, keeping the others. Needs the LLM proxy. Steer with a note.",
      inputSchema: { sessionId: z.string(), index: z.number().describe("Zero-based variant index."), steer: z.string().optional() },
    },
    async (args) => text({ variants: await generateVariants(args.sessionId, { index: args.index, steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_save_script",
    {
      title: "Save a script",
      description: "Save one variant as a script and record it as the chosen variant. Give the variant index and a title.",
      inputSchema: { sessionId: z.string(), variantIndex: z.number(), title: z.string() },
    },
    async (args) => {
      const session = await getRemixSession(args.sessionId);
      if (!session) return text({ error: "session not found", sessionId: args.sessionId });
      const content = session.variants?.[args.variantIndex];
      if (typeof content !== "string") return text({ error: "no variant text at that index", variantIndex: args.variantIndex });
      const { scriptId } = await saveScript(args.sessionId, content, args.title, args.variantIndex);
      return text({ ok: true, scriptId });
    }
  );

  server.registerTool(
    "crowsnest_remix_finish",
    {
      title: "Finish the remix",
      description: "Finish a session: create (or reuse) an undated draft planned post carrying the chosen script, and return its postId. Idempotent.",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => text(await finishRemix(args.sessionId))
  );

  return server;
}
