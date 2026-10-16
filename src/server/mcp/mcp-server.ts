import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getOutlierFeed, type FeedFilters, type FeedSort } from "@/server/queries/feed";
import { getVideoDetail } from "@/server/queries/video";
import { getPostBrief } from "@/server/queries/post-brief";
import { getScripts } from "@/server/queries/vault";
import { getPlannedPostById, getPlannedPosts } from "@/server/queries/planned-posts";
import { setPlanFieldsAction } from "@/server/actions/planned-post-actions";
import { attachPlanVideo } from "@/server/media/video-file";
import { OutlineSchema } from "@/server/schemas";
import {
  getOrCreateSession,
  getRemixSession,
  updateStage,
  buildResearch,
  buildHookPrompt,
  buildOutlinePrompt,
  buildScriptPrompt,
  saveAgentScript,
  finishRemix,
} from "@/server/services/remix";
import { listIdeas } from "@/server/queries/ideas";
import { getOwnPosts, getOwnChannelOverview } from "@/server/queries/own-channel";
import { getAsset, resolveAssetPath } from "@/server/media/store";
import { saveAgentAnalysis } from "@/server/services/analyze";
import { getOrCreateTranscript } from "@/server/transcribe";
import { downloadVideoAction } from "@/server/actions/media-actions";
import { errorMessage } from "@/server/lib/action-result";
import { startSyncAction, getSyncProgressAction, cancelSyncAction } from "@/server/actions/sync-actions";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { getChannelsList, getChannelDetail, getChannelMedianBasis } from "@/server/queries/channels";
import { getLastRunHealth } from "@/server/queries/runs";
import { getResearchSet, getOutlierPack } from "@/server/queries/research";
import { saveArtifact, listArtifacts, getArtifact, ARTIFACT_KINDS } from "@/server/services/artifacts";

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

// The exact shell command that brings the Instagram sidecar up (scripts/ig-service.sh via
// the npm script). An external agent has no other way to learn this, so both the readiness
// tool and a sidecar-down sync error carry it verbatim rather than a paraphrase.
const IG_SERVICE_BOOTSTRAP = "npm run ig:service";

// Seconds left on an in-effect rate-limit cooldown, or undefined when there is none or it
// has already passed. cooldownUntil is the ISO timestamp the sidecar sets while backing
// off after a 429 (IgHealth.cooldownUntil); ceil so a near-zero remainder still reads as
// "wait a second", not 0.
function retryAfterSecFrom(cooldownUntil: string | null): number | undefined {
  if (!cooldownUntil) return undefined;
  const ms = Date.parse(cooldownUntil) - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : undefined;
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
    { instructions: "Crowsnest is the data and action brain; YOU are the reasoning brain. Keyless: no internal model key or proxy is used anywhere in this chain. Full content-machine flow: (1) SYNC — check crowsnest_ig_status, then crowsnest_sync_selected the channels you want, poll crowsnest_sync_status. (2) INSPECT — crowsnest_feed for over-performers, crowsnest_video for one video's analysis, transcript, metrics, and media paths; crowsnest_research_set / crowsnest_outlier_pack for working-set bundles; crowsnest_channels / crowsnest_channel_stats / crowsnest_metrics for the landscape. (3) ANALYZE and PERSIST — write your own analysis of why a video worked and save it with crowsnest_save_analysis; save your larger reasoning outputs (angles, an outlier library, an idea bank of 100+ ideas, a Week 01 to 04 monthly plan, briefs) with crowsnest_save_artifact, stamped with provenance (agent, model, sourceVideoIds, assumptions). Read them back with crowsnest_artifacts. (4) REMIX one video into a script with the crowsnest_remix_* chain: session, set_prompt, research, hooks (returns a prompt, you write the hooks), choose_hook, style, outline (returns a prompt, you write the outline), variants (returns a prompt, you write the script), save_script, finish (creates a draft planned post). crowsnest_brief returns a planned post's brief with source media paths for the Reel Factory handoff. crowsnest_scripts, crowsnest_ideas, and crowsnest_plans are read-only; crowsnest_set_plan_fields sets a plan's comment keyword and guide link; crowsnest_attach_video attaches a rendered local mp4 to a plan." }
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

  // On-demand transcription. crowsnest_video only returns a transcript when a `transcripts`
  // row already exists; nothing else in the MCP surface creates one (sync downloads
  // thumbnails, never video bytes, and the auto-analyze pass that once transcribed was
  // retired in P0 slice 2a). This is the only path that fetches the video and transcribes
  // it on request, so an agent can ground an analysis in verbatim words for a post older
  // than any prior transcript. Reuses downloadVideoAction (idempotent: no-ops when the
  // video is already stored) then getOrCreateTranscript (cache-first, so a repeat call is
  // instant and free).
  server.registerTool(
    "crowsnest_transcribe",
    {
      title: "Transcribe video",
      description:
        "Fetch and transcribe one video by id, returning its verbatim transcript. Downloads the video from Instagram on demand if it is not already stored (needs a live IG sidecar session), then runs the local whisper.cpp then Groq fallback chain and caches the result; a repeat call returns the cached transcript instantly. Use this to ground an analysis in the exact words of a post that has no transcript yet. Errors (isError) when the id is unknown, the post is a photo or carousel with no downloadable video, Instagram cannot be reached, or no transcript provider is available.",
      inputSchema: { videoId: z.string().describe("The video id, from crowsnest_feed items.") },
    },
    async (args) => {
      const dl = await downloadVideoAction(args.videoId);
      if (!dl.ok) return errorResult({ error: dl.error, videoId: args.videoId });
      try {
        const transcript = await getOrCreateTranscript(args.videoId);
        return result({ videoId: args.videoId, ...transcript });
      } catch (err) {
        return errorResult({ error: errorMessage(err), videoId: args.videoId });
      }
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
      description: "The ideas inbox or shortlist: short concepts drawn from videos, for the weekly plan. Defaults to the inbox.",
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
    "crowsnest_attach_video",
    {
      title: "Attach a rendered video to a plan",
      description: "Attaches a local mp4 (absolute path on the crowsnest host) to one planned post as its publish video. Refuses a missing file, a non-mp4, a file over 200 MB, an unknown plan, and a plan already publishing or published. The same file attached twice reuses one stored asset.",
      inputSchema: {
        postId: z.string().describe("The planned post id, from crowsnest_plans."),
        path: z.string().min(1).describe("Absolute path to the rendered .mp4 on this machine."),
      },
    },
    async (args) => {
      const res = await attachPlanVideo(args.postId, args.path);
      if (!res.ok) return errorResult({ error: res.error, code: res.code, postId: args.postId });
      return result(await getPlannedPostById(args.postId));
    }
  );

  server.registerTool(
    "crowsnest_set_plan_fields",
    {
      title: "Set a plan's keyword and guide link",
      description: "Sets the comment keyword and the guide (lead magnet) URL on one planned post. Works on a plan in any state, including scheduled and published, since a live reel still needs its keyword. Omit a field to leave it, pass null to clear it. A keyword another plan holds, compared case-insensitively for ASCII letters, returns code KEYWORD_TAKEN and writes nothing. Every refusal returns {error, code, postId}. A blank keyword, one over 64 characters, or one with a control character or line break returns PLAN_KEYWORD_INVALID. A guide link that does not start with http:// or https://, is over 2048 characters, has a control character, or carries a user or password returns PLAN_MAGNET_URL_INVALID.",
      inputSchema: {
        postId: z.string().describe("The planned post id, from crowsnest_plans."),
        keyword: z.string().nullable().optional().describe("Comment keyword, e.g. PLUGIN. Trimmed, 1 to 64 characters. Unique across plans, case-insensitive for ASCII letters."),
        magnetUrl: z.string().nullable().optional().describe("The guide link the keyword sends, starting with http:// or https://. Stored as given, trimmed."),
      },
    },
    async (args) => {
      const res = await setPlanFieldsAction(args.postId, { keyword: args.keyword, magnetUrl: args.magnetUrl });
      if (!res.ok) return errorResult({ error: res.error, code: res.code, postId: args.postId });
      return result(await getPlannedPostById(args.postId));
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
        summary: z.string().optional().describe("A one-paragraph summary of the video, shown at the top of the video detail page."),
      },
    },
    async (args) => {
      const r = await saveAgentAnalysis(args.videoId, args);
      return r.ok ? result({ ok: true, videoId: args.videoId }) : errorResult({ error: r.error, videoId: args.videoId });
    }
  );

  // Content-machine persistence. The downstream artifacts of the flow — angles, an outlier
  // library, an idea bank (100+ ideas), a Week 01 to 04 monthly plan, and briefs — are
  // authored by YOU (the agent) and persisted here with provenance. Keyless: nothing below
  // ever calls a model. save_analysis above is the per-video sibling; these carry the
  // larger, cross-video reasoning outputs.

  server.registerTool(
    "crowsnest_save_artifact",
    {
      title: "Save a content artifact",
      description:
        "Persist an artifact YOU (the agent) authored, as crowsnest's source of truth, with provenance. Kinds: angles, outlier_library, idea_bank (put 100+ ideas in one artifact), monthly_plan (Week 01 to 04), brief. Keyless: never calls any model. `data` is your own JSON — the shape is up to you for the kind. Pass an existing `id` to update in place. Returns the stored artifact with its id and timestamps. Read them back with crowsnest_artifacts.",
      inputSchema: {
        kind: z.enum(ARTIFACT_KINDS).describe("angles | outlier_library | idea_bank | monthly_plan | brief."),
        title: z.string().describe("A short human title for this artifact."),
        data: z.unknown().describe("Your artifact payload as JSON. e.g. idea_bank: an array of 100+ ideas; monthly_plan: weeks 01-04 with picks; angles: the angle list."),
        agent: z.string().describe("Who reasoned this, for provenance: 'claude', 'codex', or your label."),
        sourceVideoIds: z.array(z.string()).optional().describe("Video ids that informed this artifact (provenance), from crowsnest_feed."),
        model: z.string().optional().describe("Your model id, if known (provenance)."),
        assumptions: z.string().optional().describe("Assumptions you made while reasoning (provenance)."),
        id: z.string().optional().describe("An existing artifact id to update in place; omit to create a new one."),
      },
    },
    async (args) => {
      const r = await saveArtifact(args);
      return r.ok ? result({ ok: true, id: r.id, artifact: r.artifact }) : errorResult({ error: r.error });
    }
  );

  server.registerTool(
    "crowsnest_artifacts",
    {
      title: "Read content artifacts",
      description:
        "List agent-authored content artifacts (angles, outlier libraries, idea banks, monthly plans, briefs), newest first, or fetch one by id. This is how you read back what you (or a prior agent run) persisted with crowsnest_save_artifact.",
      inputSchema: {
        id: z.string().optional().describe("Fetch exactly this artifact; returns an error when the id is unknown."),
        kind: z.enum(ARTIFACT_KINDS).optional().describe("Only artifacts of this kind."),
        limit: z.number().optional().describe("Max items, default 20."),
        offset: z.number().optional().describe("Skip this many, for paging."),
      },
    },
    async (args) => {
      if (args.id) {
        const a = await getArtifact(args.id);
        return a ? result(a) : errorResult({ error: "not found", id: args.id });
      }
      return result(await listArtifacts({ kind: args.kind, limit: args.limit ?? 20, offset: args.offset ?? 0 }));
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
      if (r.ok) return result({ jobId: r.jobId });
      // IG_SERVICE_DOWN means the agent's very next move should be starting the sidecar;
      // the exact command travels with the error so it doesn't have to go find it.
      return errorResult({
        error: r.error,
        code: r.code,
        ...(r.code === "IG_SERVICE_DOWN" ? { bootstrap: IG_SERVICE_BOOTSTRAP } : {}),
      });
    }
  );

  server.registerTool(
    "crowsnest_ig_status",
    {
      title: "Instagram sidecar readiness",
      description:
        "Whether the Instagram sidecar is reachable and, if so, logged in. Check this before crowsnest_sync_selected so a sync attempt isn't the first sign the sidecar needs starting. bootstrap is the exact command to start it. Reuses the same health probe Settings' sidecar control shows, so it never opens a second probe.",
      inputSchema: {},
    },
    async () => {
      const r = await getIgStatusAction();
      if (r.ok) {
        const retryAfterSec = retryAfterSecFrom(r.status.cooldownUntil);
        return result({
          reachable: true,
          loggedIn: r.status.loggedIn,
          ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
          bootstrap: IG_SERVICE_BOOTSTRAP,
        });
      }
      // Not an MCP error: successfully determining "it's down" is a normal read. Only
      // IG_SERVICE_DOWN means genuinely unreachable — every other failure code (a bad
      // token, a drifted response shape) still means the sidecar answered.
      return result({
        reachable: r.code !== "IG_SERVICE_DOWN",
        loggedIn: null,
        bootstrap: IG_SERVICE_BOOTSTRAP,
        error: r.error,
        code: r.code,
      });
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
  // the same service functions the dashboard uses, except the three generate stages
  // (hooks, outline, variants): the MCP path is keyless (P0 slice 2b) — they return the
  // assembled { system, user, context } prompt instead of calling an internal model, and
  // the calling agent writes the result itself and reports it back (choose_hook,
  // save_script). The remix chain makes no model calls of its own. Stage
  // progression on the session is left to the service functions (finish sets the stage);
  // these tools do not manage the stepper, since that only affects how the dashboard
  // renders the session.

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
      title: "Hook prompt",
      description:
        "Returns the prompt for the Hooks stage: { system, user, context }. No internal model call, no proxy or key needed — YOU (the calling agent) write 5 hook options by fulfilling this prompt, then set your pick with crowsnest_remix_choose_hook. Optionally seed the prompt from a vault hook, or steer it with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        vaultItemId: z.string().optional().describe("A vault hook item id to seed the prompt from."),
        steer: z.string().optional().describe("A note to steer the prompt, e.g. punchier."),
      },
    },
    async (args) => result(await buildHookPrompt(args.sessionId, { vaultItemId: args.vaultItemId, steer: args.steer }))
  );

  server.registerTool(
    "crowsnest_remix_choose_hook",
    {
      title: "Choose a hook",
      description: "Set the chosen hook on a session, by its text (one of the generated hooks, or your own).",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        hook: z.string().describe("The hook text to set as chosen, from crowsnest_remix_hooks or your own."),
        hooks: z.array(z.string()).optional().describe("All the hook options you wrote, so the studio can show them."),
      },
    },
    async (args) => {
      await updateStage(args.sessionId, { chosenHook: args.hook, ...(args.hooks ? { hookOptions: args.hooks } : {}) });
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
      title: "Outline prompt",
      description:
        "With no outline argument: returns the prompt for the Outline stage, { system, user, context }. No internal model call, no proxy or key needed — YOU write the beat outline by fulfilling this prompt from the session's chosen hook and style. Passing an outline saves it onto the session instead (same shape you wrote it in: { beats: [{ label, content, targetSec }] }), so crowsnest_remix_variants' script prompt carries YOUR real beats rather than a placeholder. Steer with a note (prompt mode only).",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        steer: z.string().optional().describe("A note to steer the prompt (prompt mode only)."),
        outline: OutlineSchema.optional().describe(
          "Your outline to save: { beats: [{ label, content, targetSec }] }. Omit to get the prompt instead."
        ),
      },
    },
    async (args) => {
      if (args.outline !== undefined) {
        await updateStage(args.sessionId, { outline: args.outline, variants: [], chosenVariantIndex: null });
        return result({ ok: true, outline: args.outline });
      }
      return result(await buildOutlinePrompt(args.sessionId, { steer: args.steer }));
    }
  );

  server.registerTool(
    "crowsnest_remix_variants",
    {
      title: "Script prompt",
      description:
        "Returns the prompt for the Script stage: { system, user, context }. No internal model call, no proxy or key needed — YOU write the script by fulfilling this prompt from the session's chosen hook and outline, then save it with crowsnest_remix_save_script. context.angles lists the fixed per-take angles crowsnest itself used to vary multiple takes; append one to the prompt yourself if you want more than one script to choose between. Steer with a note.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        steer: z.string().optional().describe("A note to steer the prompt."),
      },
    },
    async (args) => result(await buildScriptPrompt(args.sessionId, { steer: args.steer }))
  );

  server.registerTool(
    "crowsnest_remix_save_script",
    {
      title: "Save a script",
      description: "Save YOUR script text (from fulfilling crowsnest_remix_variants' prompt) as this session's script, titled. No internal model call.",
      inputSchema: {
        sessionId: z.string().describe("The remix session id, from crowsnest_remix_session."),
        title: z.string().describe("Title to give the saved script."),
        script: z.string().describe("The full script text you wrote."),
      },
    },
    async (args) => {
      const { scriptId } = await saveAgentScript(args.sessionId, args.script, args.title);
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
