import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedPostRow } from "@/server/queries/planned-posts";
import type { VideoDetail } from "@/server/queries/video";

const getStudioBrief = vi.fn();
vi.mock("@/server/queries/studio", () => ({ getStudioBrief: (postId: string) => getStudioBrief(postId) }));

const getPersona = vi.fn();
vi.mock("@/server/services/persona", () => ({ getPersona: () => getPersona() }));

function fakePlan(overrides: Partial<PlannedPostRow> = {}): PlannedPostRow {
  return {
    id: "post-1",
    state: "draft",
    title: "3 Mistakes Killing Your Reach",
    note: null,
    plannedDate: null,
    plannedTime: null,
    targetLengthSec: 45,
    videoKind: "talking-head",
    scriptId: "script-1",
    scriptTitle: "Draft v1",
    scriptLengthChars: 812,
    scriptContent: "Hook: stop scrolling.\n\nBeat 1: here's mistake one...\n\nBeat 2: here's mistake two...",
    scriptDetachedNote: null,
    remixSessionId: null,
    sourceVideoId: "video-1",
    publishedOwnPostId: null,
    reconciledOwnPostId: null,
    ...overrides,
  };
}

function fakeVideo(overrides: Partial<VideoDetail> = {}): VideoDetail {
  return {
    item: {
      videoId: "video-1",
      url: "https://instagram.com/reel/abc123",
      caption: "3 mistakes that kill your reach",
      mediaType: "video",
      thumbnailAssetId: null,
      videoAssetId: null,
      postedAt: "2026-08-01T00:00:00.000Z",
      durationSec: 30,
      viewCount: 500000,
      outlierScore: 8.2,
      engagementRate: 0.05,
      deleted: false,
      channel: {
        id: "channel-1",
        handle: "some_creator",
        displayName: "Some Creator",
        avatarAssetId: null,
        followerCount: 10000,
        platform: "instagram",
      },
    },
    likeCount: 20000,
    commentCount: 300,
    children: [],
    deletedAt: null,
    transcript: { text: "Hey, here are three mistakes...", source: "whisper" },
    analysis: {
      hookType: "curiosity-gap",
      structureSegments: [
        { label: "Hook", startSec: 0, endSec: 3, note: "opens on a warning", transcript: "Hey, here are three mistakes" },
      ],
      formatTags: [],
      styleTags: [],
      whyItWorked: "strong hook",
      summary: null,
      layout: [
        {
          startSec: 0,
          endSec: 3,
          label: "Hook",
          onScreenText: { value: "3 MISTAKES", fromFramesSec: [0.5, 1.2] },
          animation: { value: "hard shake", fromFramesSec: [1.2] },
          demoCursor: { value: null, fromFramesSec: [] },
          toolDemo: { value: null, fromFramesSec: [] },
          textPosition: { value: "upper third", fromFramesSec: [0.5] },
          voicePace: { value: "fast cuts", fromFramesSec: [1, 2, 3] },
        },
      ],
      framesSampled: 12,
      frameModel: "claude-code/watch",
      framePassAt: "2026-08-01T01:00:00.000Z",
      framePassError: null,
    },
    ...overrides,
  };
}

describe("writeBrief", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "write-brief-test-"));
    getPersona.mockResolvedValue({ audience: "", voice: "", do: "", dont: "" });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("writes brief.md with title, source outlier, script, target length, video kind, and frame-pass layout", async () => {
    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan(), video: fakeVideo() });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("# Cook brief: 3 Mistakes Killing Your Reach");
    expect(content).toContain("## Source outlier");
    expect(content).toContain("@some_creator");
    expect(content).toContain("https://instagram.com/reel/abc123");
    expect(content).toContain("3 mistakes that kill your reach");
    expect(content).toContain("Hey, here are three mistakes...");
    expect(content).toContain("## Script");
    expect(content).toContain("Draft v1");
    expect(content).toContain("812 chars");
    expect(content).toContain("Hook: stop scrolling.");
    expect(content).toContain("Beat 1: here's mistake one...");
    expect(content).toContain("Beat 2: here's mistake two...");
    expect(content).toContain("## Target length");
    expect(content).toContain("45s");
    expect(content).toContain("## Video kind");
    expect(content).toContain("talking-head");
    expect(content).toContain("## Layout per beat");
    expect(content).toContain("3 MISTAKES");
    expect(content).toContain("upper third");
    expect(content).toContain("fast cuts");
    expect(content).toContain("### Hook (0s to 3s)"); // one block per beat, keyed to the beat window
  });

  it("writes '(no source video)' rather than fabricating a source section when the plan has no video", async () => {
    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan({ sourceVideoId: null }), video: null });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("## Source outlier");
    expect(content).toContain("(no source video)");
    // No fabricated caption/url/channel content anywhere in the file.
    expect(content).not.toContain("instagram.com");
    expect(content).not.toContain("@some_creator");
  });

  it("carries the remix's chosen hook, per-beat transcript, and per-beat layout when the plan came from a remix", async () => {
    getStudioBrief.mockResolvedValueOnce({
      plan: fakePlan({ remixSessionId: "session-1" }),
      video: fakeVideo(),
      remix: {
        session: {
          id: "session-1",
          sourceVideoId: "video-1",
          stage: "finish",
          topic: null,
          niche: null,
          targetLengthSec: null,
          researchNotes: null,
          hookOptions: null,
          chosenHook: "Everyone is sleeping on this.",
          styleVaultItemId: null,
          outline: null,
          variants: ["one"],
          chosenVariantIndex: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        sourceAnalysis: fakeVideo().analysis,
      },
    });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");
    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("## Hook");
    expect(content).toContain("Everyone is sleeping on this.");
    expect(content).toContain("## Beats");
    expect(content).toContain("Hey, here are three mistakes"); // the beat's verbatim words
    expect(content).toContain("opens on a warning"); // the beat's summary
    expect(content).toContain("## Layout per beat");
    expect(content).toContain("3 MISTAKES");
  });

  it("writes no Hook or Beats section at all for a plan that did not come from a remix", async () => {
    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan(), video: fakeVideo(), remix: null });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");
    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    // A "## Hook" heading over "(none)" would imply a hook was chosen and then lost.
    // Matched line-anchored, because the layout section's per-beat "### Hook (0s to 3s)"
    // headings contain "## Hook" as a substring.
    expect(content.split("\n")).not.toContain("## Hook");
    expect(content.split("\n")).not.toContain("## Beats");
  });

  it("names a beat with no captured transcript instead of quoting words it does not have", async () => {
    const analysis = fakeVideo().analysis;
    getStudioBrief.mockResolvedValueOnce({
      plan: fakePlan({ remixSessionId: "session-1" }),
      video: fakeVideo(),
      remix: {
        session: {
          id: "session-1",
          sourceVideoId: "video-1",
          stage: "finish",
          topic: null,
          niche: null,
          targetLengthSec: null,
          researchNotes: null,
          hookOptions: null,
          chosenHook: null,
          styleVaultItemId: null,
          outline: null,
          variants: null,
          chosenVariantIndex: null,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        sourceAnalysis: {
          ...analysis,
          // A row from before beats carried a transcript.
          structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "opens on a warning" }],
        },
      },
    });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");
    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("(not captured; re-analyze the source video)");
    expect(content).toContain("(no hook chosen in the remix)");
  });

  it("writes '(frame pass not run)' rather than fabricating a layout when the video has no analysis", async () => {
    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan(), video: fakeVideo({ analysis: null }) });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("## Layout per beat");
    expect(content).toContain("(frame pass not run)");
  });

  it("writes '(no script attached)' rather than fabricating a body when the plan carries no script", async () => {
    getStudioBrief.mockResolvedValueOnce({
      plan: fakePlan({ scriptId: null, scriptTitle: null, scriptLengthChars: null, scriptContent: null }),
      video: null,
    });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(content).toContain("(no script attached)");
    expect(content).not.toContain("Hook: stop scrolling.");
  });

  it("prints the full script body (not just title/length) when a script is attached", async () => {
    getStudioBrief.mockResolvedValueOnce({
      plan: fakePlan({ scriptContent: "Line one of the script.\nLine two of the script." }),
      video: null,
    });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");
    const scriptSection = content.split("## Script")[1].split("##")[0];

    expect(scriptSection).toContain("Line one of the script.");
    expect(scriptSection).toContain("Line two of the script.");
  });

  it("says '(not set)' for target length and video kind instead of fabricating a value when absent", async () => {
    getStudioBrief.mockResolvedValueOnce({
      plan: fakePlan({ targetLengthSec: null, videoKind: null }),
      video: null,
    });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");

    const content = await readFile(path.join(dir, "brief.md"), "utf8");
    const targetSection = content.split("## Target length")[1].split("##")[0];
    const kindSection = content.split("## Video kind")[1].split("##")[0];

    expect(targetSection).toContain("(not set)");
    expect(kindSection).toContain("(not set)");
  });

  it("emits a Persona section with its fields when persona is set, and omits it entirely when empty", async () => {
    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan(), video: null });
    getPersona.mockResolvedValueOnce({ audience: "ambitious solo founders", voice: "direct, no fluff", do: "short sentences", dont: "buzzwords" });
    const { writeBrief } = await import("./write-brief");

    await writeBrief(dir, "post-1");
    const withPersona = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(withPersona).toContain("## Persona");
    expect(withPersona).toContain("ambitious solo founders");
    expect(withPersona).toContain("direct, no fluff");

    getStudioBrief.mockResolvedValueOnce({ plan: fakePlan(), video: null });
    getPersona.mockResolvedValueOnce({ audience: "", voice: "", do: "", dont: "" });

    await writeBrief(dir, "post-1");
    const withoutPersona = await readFile(path.join(dir, "brief.md"), "utf8");

    expect(withoutPersona).not.toContain("## Persona");
  });

  it("throws rather than writing a file when no plan exists for the postId", async () => {
    getStudioBrief.mockResolvedValueOnce(null);
    const { writeBrief } = await import("./write-brief");

    await expect(writeBrief(dir, "no-such-post")).rejects.toThrow();

    await expect(readFile(path.join(dir, "brief.md"), "utf8")).rejects.toThrow();
  });
});
