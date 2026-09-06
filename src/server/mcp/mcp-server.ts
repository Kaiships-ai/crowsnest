import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";
import { getVideoDetail } from "@/server/queries/video";
import { getPostBrief } from "@/server/queries/post-brief";
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
import { listIdeas } from "@/server/queries/ideas";
import { getOwnPosts, getOwnChannelOverview } from "@/server/queries/own-channel";
import { getAsset, resolveAssetPath } from "@/server/media/store";
import { saveAgentAnalysis } from "@/server/services/analyze";
import { startSyncAction, getSyncProgressAction, cancelSyncAction } from "@/server/actions/sync-actions";
import { getChannelsList, getChannelDetail, getChannelMedianBasis } from "@/server/queries/channels";
import { getLastRunHealth } from "@/server/queries/runs";
import { getResearchSet, getOutlierPack } from "@/server/queries/research";

/**
 * The Crowsnest MCP server. Read tools only for now (the generate/remix tools are added
 * separately). Every tool is a thin wrapper over an existing query function, so the MCP
 * surface and the dashboard read the same data through the same code. Mounted inside the
 * app's own server process (see server.ts), so it shares the one SQLite connection and
 * never becomes a second writer.
 */

// A tool result the SDK will surface both ways: JSON text for a text-only client, and
// structuredContent for a client that reads structured output. The MCP spec requires
// structuredContent to be a record; the SDK hard-rejects a bare array or primitive, so
// those get wrapped under a `data` key. content[0].text is always the JSON of the
// original value, unwrapped.
export function result(value: unknown) {
  const structuredContent =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { data: value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

// A typed, non-throwing error: isError true so the caller sees a failure, with a machine
// -readable payload rather than a thrown exception crossing the MCP boundary.
export function errorResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true as const,
  };
}

export interface MediaInfo {
  path: string | null;
  byteSize: number;
  durationSec: number | null;
}

// On-disk location and stored size/duration for a media asset id, for the Reel Factory
// handoff. Null when the id is null or the asset row is gone. Every field comes from the
// media_assets row: this NEVER stats or reads the file, and never throws across the MCP
// boundary. path is null (not an error) if the stored storagePath is somehow invalid.
export async function mediaInfoFor(assetId: string | null | undefined): Promise<MediaInfo | null> {
  if (!assetId) return null;
  const asset = await getAsset(assetId);
  if (!asset) return null;
  let path: string | null;
  try {
    path = resolveAssetPath(asset.storagePath);
  } catch {
    path = null;
  }
  return { path, byteSize: asset.byteSize, durationSec: asset.durationSec ?? null };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "crowsnest", version: "0.1.0" },
    { instructions: "Read Crowsnest data and drive a remix end to end. Browse over-performers with crowsnest_feed, read one with crowsnest_video (its analysis, plus the source media path, size, and duration for handoff), then run the crowsnest_remix_* chain (session, set_prompt, research, hooks, choose_hook, style, outline, variants, save_script, finish) to turn it into a script and a draft planned post. crowsnest_brief returns a planned post's brief with source media paths for the Reel Factory handoff. crowsnest_scripts, crowsnest_ideas, crowsnest_metrics, and crowsnest_plans are read-only." }
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
      return result({ total, count: items.length, items });
    }
  );

  server.registerTool(
    "crowsnest_video",
    {
      title: "Video detail",
      description: "One video with its analysis, transcript, and metrics, by video id. Also returns media and thumbnail objects, each with the source file path, byteSize, and durationSec, for the Reel Factory handoff. Returns null when the id is unknown.",
      inputSchema: { videoId: z.string().describe("The video id, from crowsnest_feed items.") },
    },
    async (args) => {
      const detail = await getVideoDetail(args.videoId);
      if (!detail) return errorResult({ error: "not found", videoId: args.videoId });
      const media = await mediaInfoFor(detail.item.videoAssetId);
      const thumbnail = await mediaInfoFor(detail.item.thumbnailAssetId);
      return result({ ...detail, media, thumbnail });
    }
  );

  server.registerTool(
    "crowsnest_brief",
    {
      title: "Post brief",
      description: "The brief for a planned post: its title, the source video (with its media and thumbnail file paths, byteSize, and durationSec for the Reel Factory handoff), the remix hook and beats, the layout, and the score. By planned post id. Returns null when unknown.",
      inputSchema: { postId: z.string().describe("The planned post id, from crowsnest_remix_finish (the handoff path) or crowsnest_plans.") },
    },
    async (args) => {
      const brief = await getPostBrief(args.postId);
      if (!brief) return errorResult({ error: "not found", postId: args.postId });
      const video = brief.video
        ? {
            ...brief.video,
            media: await mediaInfoFor(brief.video.item.videoAssetId),
            thumbnail: await mediaInfoFor(brief.video.item.thumbnailAssetId),
          }
        : null;
      return result({ ...brief, video });
    }
  );

  server.registerTool(
    "crowsnest_scripts",
    {
      title: "Saved scripts",
      description: "Every saved script, newest first. A script is the text a remix produced.",
      inputSchema: {
        limit: z.number().optional().describe("Max items, default 50."),
        offset: z.number().optional().describe("Skip this many, for paging."),
      },
    },
    async (args) => {
      // ponytail: naive in-memory slice over the full read; getScripts() takes no
      // pagination args. Fine for a local single-user SQLite vault — swap for a SQL
      // LIMIT/OFFSET in getScripts if it ever holds thousands of scripts.
      const all = await getScripts();
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 50;
      const items = all.slice(offset, offset + limit);
      return result({ total: all.length, count: items.length, items });
    }
  );

  server.registerTool(
    "crowsnest_ideas",
    {
      title: "Ideas",
      description: "The ideas inbox or shortlist: short concepts generated from videos, for the weekly plan. Defaults to the inbox.",
      inputSchema: {
        tab: z.enum(["inbox", "shortlist"]).optional().describe("Which list, default inbox."),
        limit: z.number().optional().describe("Max items, default 50."),
        offset: z.number().optional().describe("Skip this many, for paging."),
      },
    },
    async (args) => {
      // ponytail: same in-memory slice as crowsnest_scripts — listIdeas() takes no
      // pagination args either.
      const all = await listIdeas({ tab: args.tab ?? "inbox" });
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 50;
      const items = all.slice(offset, offset + limit);
      return result({ total: all.length, count: items.length, items });
    }
  );

  server.registerTool(
    "crowsnest_metrics",
    {
      title: "Own channel metrics",
      description: "How the user's own channel is doing, month over month: the current window overview AND the immediately prior window of the same length (so the plan reads this period against the one before it), plus the recent measured own posts (from the Graph API). Needs an own channel set and a valid Graph token; returns an error otherwise.",
      inputSchema: {
        windowDays: z.number().optional().describe("Overview window in days, default 30. The prior window is the same length, immediately before it."),
        limit: z.number().optional().describe("How many recent own posts, default 20."),
      },
    },
    async (args) => {
      try {
        const current = await getOwnChannelOverview(args.windowDays, { offsetDays: 0 });
        // Same length, immediately before the current window — the resolved windowDays,
        // so passing no windowDays still lines the two windows up.
        const previous = await getOwnChannelOverview(current.windowDays, { offsetDays: current.windowDays });
        const posts = await getOwnPosts({ limit: args.limit ?? 20 });
        return result({ current, previous, posts });
      } catch (err) {
        return errorResult({ error: err instanceof Error ? err.message : "metrics unavailable", hint: "set an own channel and a valid Graph token" });
      }
    }
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
      return result(await getPlannedPosts(range));
    }
  );

  server.registerTool(
    "crowsnest_save_analysis",
    {
      title: "Save an agent-authored analysis",
      description:
        "Save the analysis YOU (the agent) wrote for a video, with provenance. Validates the fields against the same schema the in-app analyzer uses and stores them stamped source=\"mcp\". Remix and Ideas then read this analysis. Never calls any in-app model. Rejects (without writing) an unknown video id or fields that fail validation.",
      inputSchema: {
        videoId: z.string().describe("The video id, from crowsnest_feed."),
        hookType: z.string().describe("The hook type, e.g. curiosity-gap, negative-warning."),
        structureSegments: z
          .array(z.any())
          .describe("Story beats: each { label, startSec, endSec, note, transcript }. transcript is the verbatim words spoken in the beat window."),
        formatTags: z.array(z.string()).describe("Format tags, e.g. talking-head, screen-recording."),
        styleTags: z.array(z.string()).describe("Style tags, e.g. fast-cut, high-energy."),
        whyItWorked: z.string().describe("Why the video over-performed."),
      },
    },
    async (args) => {
      const r = await saveAgentAnalysis(args.videoId, args);
      return r.ok ? result({ ok: true, videoId: args.videoId }) : errorResult({ error: r.error, videoId: args.videoId });
    }
  );

  // Sync control. Thin wrappers over the sync actions, each already returning a result
  // object; the MCP boundary never throws. sync_selected refuses an empty channelIds
  // array — there is no whole-library default here (matches runSync's own scoping).

  server.registerTool(
    "crowsnest_sync_selected",
    {
      title: "Sync selected channels",
      description: "Start a sync for exactly the given channel ids and return a job id. Requires a non-empty channelIds array; there is no whole-library default. Poll it with crowsnest_sync_status.",
      inputSchema: { channelIds: z.array(z.string()).describe("The channel ids to sync, from crowsnest_channels. Must be non-empty.") },
    },
    async (args) => {
      if (!Array.isArray(args.channelIds) || args.channelIds.length === 0) {
        return errorResult({ error: "channelIds must be a non-empty array", code: "NO_CHANNELS" });
      }
      const r = await startSyncAction(args.channelIds);
      return r.ok ? result({ jobId: r.jobId }) : errorResult({ error: r.error, code: r.code });
    }
  );

  server.registerTool(
    "crowsnest_sync_status",
    {
      title: "Sync status",
      description: "Read a sync run's progress by job id. Returns null progress when the id names no run.",
      inputSchema: { jobId: z.string().describe("The job id from crowsnest_sync_selected.") },
    },
    async (args) => {
      const r = await getSyncProgressAction(args.jobId);
      return r.ok ? result({ progress: r.progress }) : errorResult({ error: r.error, code: r.code });
    }
  );

  server.registerTool(
    "crowsnest_sync_cancel",
    {
      title: "Cancel a sync",
      description: "Request cooperative cancel of a running sync by job id. The run stops at its next channel boundary keeping committed work. `requested` is false when there was nothing still running to cancel.",
      inputSchema: { jobId: z.string().describe("The job id from crowsnest_sync_selected.") },
    },
    async (args) => {
      const r = await cancelSyncAction(args.jobId);
      return r.ok ? result({ ok: true, jobId: args.jobId, requested: r.requested }) : errorResult({ error: r.error, code: r.code });
    }
  );

  // Research read tools. The landscape (channels, channel_stats) and the two working-set
  // bundles (research_set broad, outlier_pack tight). Each bundle returns competitor
  // outliers (outlierScore) and the user's own posts (reachIndex) side by side — different
  // units, both returned, never merged.

  server.registerTool(
    "crowsnest_channels",
    {
      title: "Tracked channels",
      description: "The channels crowsnest tracks, with their fleets. The set the agent plans from.",
      inputSchema: {},
    },
    async () => result({ channels: await getChannelsList() })
  );

  server.registerTool(
    "crowsnest_channel_stats",
    {
      title: "Channel stats",
      description: "One channel's baseline, median basis, and last sync health. Returns an error when the id is unknown.",
      inputSchema: { channelId: z.string().describe("The channel id, from crowsnest_channels.") },
    },
    async (args) => {
      const detail = await getChannelDetail(args.channelId);
      if (!detail) return errorResult({ error: "not found", channelId: args.channelId });
      const basis = await getChannelMedianBasis(args.channelId);
      const lastRun = getLastRunHealth();
      return result({ detail, basis, lastRun });
    }
  );

  server.registerTool(
    "crowsnest_research_set",
    {
      title: "Research set",
      description: "A broad reading bundle: top outliers with their analyses, plus your own reachIndex benchmark, so each idea reads against both competitor outlierScore and your own reach (different units, both returned).",
      inputSchema: {
        minScore: z.number().optional().describe("Minimum outlier score."),
        sinceDays: z.number().optional().describe("Only videos within this many days."),
        query: z.string().optional().describe("Free-text search over caption and channel."),
        limit: z.number().optional().describe("Max outliers, default 24."),
      },
    },
    async (args) =>
      result(await getResearchSet({ minScore: args.minScore, sinceDays: args.sinceDays, query: args.query, limit: args.limit ?? 24 }))
  );

  server.registerTool(
    "crowsnest_outlier_pack",
    {
      title: "Outlier pack",
      description: "A tight top-N shortlist ready to act on: outliers with analyses, the media handoff, and your own reachIndex benchmark. Set rising=true with a short sinceDays to surface this week's surges (e.g. a launch) for the weekly refresh.",
      inputSchema: {
        limit: z.number().optional().describe("Max items, default 8."),
        sinceDays: z.number().optional().describe("Only videos within this many days."),
        rising: z.boolean().optional().describe("Rank by recency for a weekly surge instead of by score."),
      },
    },
    async (args) => {
      const pack = await getOutlierPack({ limit: args.limit ?? 8, sinceDays: args.sinceDays, rising: args.rising });
      const items = await Promise.all(
        pack.items.map(async (i) => ({
          ...i,
          media: await mediaInfoFor(i.videoAssetId),
          thumbnail: await mediaInfoFor(i.thumbnailAssetId),
        }))
      );
      return result({ items, ownBenchmark: pack.ownBenchmark });
    }
  );

  // Remix, exposed one tool per stage so a caller can steer each step. Every tool calls
  // the same service functions the dashboard uses. The generate tools (hooks, outline,
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
    async (args) => result(await getOrCreateSession(args.videoId))
  );

  server.registerTool(
    "crowsnest_remix_state",
    {
      title: "Remix session state",
      description: "The current state of a remix session: topic, chosen hook, outline, variants, chosen variant. Returns null when unknown.",
      inputSchema: { sessionId: z.string().describe("The remix session id, from crowsnest_remix_session.") },
    },
    async (args) => result(await getRemixSession(args.sessionId))
  );

  server.registerTool(
    "crowsnest_remix_set_prompt",
    {
      title: "Set the remix prompt",
      description: "Set the topic, niche, and target length on a session. All optional; only the given fields change.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        topic: z.string().optional().describe("The remix topic to set."),
        niche: z.string().optional().describe("The content niche to set."),
        targetLengthSec: z.number().optional().describe("Target script length in seconds."),
      },
    },
    async (args) => {
      const patch: { topic?: string; niche?: string; targetLengthSec?: number } = {};
      if (args.topic !== undefined) patch.topic = args.topic;
      if (args.niche !== undefined) patch.niche = args.niche;
      if (args.targetLengthSec !== undefined) patch.targetLengthSec = args.targetLengthSec;
      await updateStage(args.sessionId, patch);
      return result(await getRemixSession(args.sessionId));
    }
  );

  server.registerTool(
    "crowsnest_remix_research",
    {
      title: "Build research",
      description: "Assemble the research notes for a session from the source analysis, transcript, and similar outliers. No model call, so this works with the proxy down.",
      inputSchema: { sessionId: z.string().describe("The remix session id, from crowsnest_remix_session.") },
    },
    async (args) => result(await buildResearch(args.sessionId))
  );

  server.registerTool(
    "crowsnest_remix_hooks",
    {
      title: "Generate hooks",
      description: "Generate hook options for a session. Needs the LLM proxy. Optionally seed from a vault hook, or steer with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        vaultItemId: z.string().optional().describe("A vault hook item id to seed from."),
        steer: z.string().optional().describe("A note to steer the generation, e.g. punchier."),
      },
    },
    async (args) => result({ hooks: await generateHooks(args.sessionId, { vaultItemId: args.vaultItemId, steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_choose_hook",
    {
      title: "Choose a hook",
      description: "Set the chosen hook on a session, by its text (one of the generated hooks, or your own).",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        hook: z.string().describe("The hook text to set as chosen, from crowsnest_remix_hooks or your own."),
      },
    },
    async (args) => {
      await updateStage(args.sessionId, { chosenHook: args.hook });
      return result({ ok: true, chosenHook: args.hook });
    }
  );

  server.registerTool(
    "crowsnest_remix_style",
    {
      title: "Choose a style",
      description: "Set the style vault item on a session, or clear it (pass no styleVaultItemId) to use the source video's own structure.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        styleVaultItemId: z.string().optional().describe("A style vault item id to set; omit to clear and use the source video's own structure."),
      },
    },
    async (args) => {
      await updateStage(args.sessionId, { styleVaultItemId: args.styleVaultItemId ?? null });
      return result({ ok: true, styleVaultItemId: args.styleVaultItemId ?? null });
    }
  );

  server.registerTool(
    "crowsnest_remix_outline",
    {
      title: "Generate outline",
      description: "Generate the beat outline for a session from its chosen hook and style. Needs the LLM proxy. Steer with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        steer: z.string().optional().describe("A note to steer the generation."),
      },
    },
    async (args) => result(await generateOutline(args.sessionId, { steer: args.steer }))
  );

  server.registerTool(
    "crowsnest_remix_variants",
    {
      title: "Generate variants",
      description: "Generate script variants (three by default) for a session. Needs the LLM proxy. A failed variant is returned as an error at its slot. Steer with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        steer: z.string().optional().describe("A note to steer the generation."),
      },
    },
    async (args) => result({ variants: await generateVariants(args.sessionId, { steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_regenerate_variant",
    {
      title: "Regenerate one variant",
      description: "Regenerate a single variant slot by index, keeping the others. Needs the LLM proxy. Steer with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        index: z.number().describe("Zero-based variant index."),
        steer: z.string().optional().describe("A note to steer the generation."),
      },
    },
    async (args) => result({ variants: await generateVariants(args.sessionId, { index: args.index, steer: args.steer }) })
  );

  server.registerTool(
    "crowsnest_remix_save_script",
    {
      title: "Save a script",
      description: "Save one variant as a script and record it as the chosen variant. Give the variant index and a title.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        variantIndex: z.number().describe("Zero-based index of the variant to save."),
        title: z.string().describe("Title to give the saved script."),
      },
    },
    async (args) => {
      const session = await getRemixSession(args.sessionId);
      if (!session) return errorResult({ error: "session not found", sessionId: args.sessionId });
      const content = session.variants?.[args.variantIndex];
      if (typeof content !== "string") return errorResult({ error: "no variant text at that index", variantIndex: args.variantIndex });
      const { scriptId } = await saveScript(args.sessionId, content, args.title, args.variantIndex);
      return result({ ok: true, scriptId });
    }
  );

  server.registerTool(
    "crowsnest_remix_finish",
    {
      title: "Finish the remix",
      description: "Finish a session: create (or reuse) an undated draft planned post carrying the chosen script, and return its postId. Idempotent.",
      inputSchema: { sessionId: z.string().describe("The remix session id, from crowsnest_remix_session.") },
    },
    async (args) => result(await finishRemix(args.sessionId))
  );

  return server;
}
