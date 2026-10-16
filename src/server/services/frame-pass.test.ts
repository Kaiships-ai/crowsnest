import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import type { BeatLayout, VideoLayout } from "@/server/schemas";

// Test-DB pattern (phase-1 final-review M7): env must be set in beforeAll BEFORE any
// dynamic import of "@/server/db", mirrored across the other service tests.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let persistFramePass: typeof import("./frame-pass")["persistFramePass"];
let recordFramePassFailure: typeof import("./frame-pass")["recordFramePassFailure"];
let FramePassValidationError: typeof import("./frame-pass")["FramePassValidationError"];
let FramePassNoVideoError: typeof import("./frame-pass")["FramePassNoVideoError"];
let asBeatLayout: typeof import("@/server/schemas")["asBeatLayout"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ persistFramePass, recordFramePassFailure, FramePassValidationError, FramePassNoVideoError } = await import(
    "./frame-pass"
  ));
  ({ asBeatLayout } = await import("@/server/schemas"));
});

function field(value: string | null, frames: number[]) {
  return { value, fromFramesSec: frames };
}

function beat(over: Partial<BeatLayout> = {}): BeatLayout {
  return {
    startSec: 0,
    endSec: 3,
    label: "Hook",
    onScreenText: field("3 MISTAKES", [0.5, 1.2]),
    animation: field("hard shake on the cut", [1.2]),
    demoCursor: field(null, []),
    toolDemo: field(null, []),
    textPosition: field("centered, upper third", [0.5]),
    voicePace: field("rapid", [0.5, 1.2]),
    ...over,
  };
}

/** Two beat rows, the first one overridable. Two rather than one so a test can tell a
 *  per-row guard from a guard that only ever looks at the head of the array. */
function layout(over: Partial<BeatLayout> = {}): VideoLayout {
  return [beat(over), beat({ startSec: 3, endSec: 9, label: "Payoff" })];
}

async function seedVideo(): Promise<string> {
  migrate();
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@fp-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `fp-${videoId}`,
    url: "https://example.com/reel",
    postedAt: now,
    firstSeenAt: now,
  });
  return videoId;
}

describe("persistFramePass", () => {
  test("inserts a layout-only analysis row when none exists, leaving text columns null", async () => {
    const videoId = await seedVideo();
    await persistFramePass({ videoId, layout: layout(), framesSampled: 12, frameModel: "claude-code/watch" });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row.hookType).toBeNull();
    expect(asBeatLayout(row.layout)?.[0].onScreenText.value).toBe("3 MISTAKES");
    expect(asBeatLayout(row.layout)).toHaveLength(2);
    expect(row.framesSampled).toBe(12);
    expect(row.frameModel).toBe("claude-code/watch");
    expect(row.framePassAt).not.toBeNull();
    expect(row.framePassError).toBeNull();
  });

  test("updates the existing analysis row in place, preserving the text analysis", async () => {
    const videoId = await seedVideo();
    await db.insert(tables.videoAnalyses).values({ videoId, hookType: "curiosity-gap", model: "claude-sonnet-5", createdAt: nowIso() });

    await persistFramePass({ videoId, layout: layout(), framesSampled: 8, frameModel: "claude-code/watch" });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row.hookType).toBe("curiosity-gap");
    expect(row.model).toBe("claude-sonnet-5");
    expect(asBeatLayout(row.layout)?.[1].label).toBe("Payoff");
  });

  test("rejects a field that has a value but names no source frames (anti-fabrication)", async () => {
    const videoId = await seedVideo();
    const bad = layout({ onScreenText: field("invented text", []) });
    await expect(persistFramePass({ videoId, layout: bad, framesSampled: 5, frameModel: "claude-code/watch" })).rejects.toBeInstanceOf(
      FramePassValidationError
    );
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row).toBeUndefined();
  });

  test("allows a null-value field with no frames (the pass ran, could not read this one)", async () => {
    const videoId = await seedVideo();
    const partial = layout({ onScreenText: field(null, []) });
    await persistFramePass({ videoId, layout: partial, framesSampled: 6, frameModel: "claude-code/watch" });
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(asBeatLayout(row.layout)?.[0].onScreenText.value).toBeNull();
  });

  test("rejects a field value longer than the cap", async () => {
    const videoId = await seedVideo();
    const huge = layout({ onScreenText: field("x".repeat(5000), [0.5]) });
    await expect(
      persistFramePass({ videoId, layout: huge, framesSampled: 5, frameModel: "claude-code/watch" })
    ).rejects.toBeInstanceOf(FramePassValidationError);
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row).toBeUndefined();
  });

  test("rejects a non-positive framesSampled", async () => {
    const videoId = await seedVideo();
    await expect(persistFramePass({ videoId, layout: layout(), framesSampled: 0, frameModel: "claude-code/watch" })).rejects.toBeInstanceOf(
      FramePassValidationError
    );
  });

  test("rejects a blank frameModel", async () => {
    const videoId = await seedVideo();
    await expect(persistFramePass({ videoId, layout: layout(), framesSampled: 4, frameModel: "  " })).rejects.toBeInstanceOf(
      FramePassValidationError
    );
  });

  test("the anti-fabrication guard reaches beat rows past the first, not just the head of the array", async () => {
    const videoId = await seedVideo();
    const bad = [beat(), beat({ startSec: 3, endSec: 9, label: "Payoff", toolDemo: field("Figma", []) })];
    await expect(
      persistFramePass({ videoId, layout: bad, framesSampled: 5, frameModel: "claude-code/watch" })
    ).rejects.toBeInstanceOf(FramePassValidationError);
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row).toBeUndefined();
  });

  test("rejects an empty layout array (a pass that read no beats failed, it did not read nothing)", async () => {
    const videoId = await seedVideo();
    await expect(
      persistFramePass({ videoId, layout: [], framesSampled: 5, frameModel: "claude-code/watch" })
    ).rejects.toBeInstanceOf(FramePassValidationError);
  });

  test("rejects a beat whose window runs backwards", async () => {
    const videoId = await seedVideo();
    const bad = [beat({ startSec: 9, endSec: 3 })];
    await expect(
      persistFramePass({ videoId, layout: bad, framesSampled: 5, frameModel: "claude-code/watch" })
    ).rejects.toBeInstanceOf(FramePassValidationError);
  });

  test("a per-beat layout round-trips through the json column with its beat keys intact", async () => {
    const videoId = await seedVideo();
    await persistFramePass({ videoId, layout: layout(), framesSampled: 9, frameModel: "claude-code/watch" });
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    const beats = asBeatLayout(row.layout);
    expect(beats?.map((b) => [b.label, b.startSec, b.endSec])).toEqual([
      ["Hook", 0, 3],
      ["Payoff", 3, 9],
    ]);
    expect(beats?.[0].voicePace.fromFramesSec).toEqual([0.5, 1.2]);
  });

  test("throws when the video does not exist", async () => {
    migrate();
    await expect(persistFramePass({ videoId: "nope", layout: layout(), framesSampled: 4, frameModel: "claude-code/watch" })).rejects.toBeInstanceOf(
      FramePassNoVideoError
    );
  });
});

describe("recordFramePassFailure", () => {
  test("sets framePassError and leaves layout null (ran, came back empty)", async () => {
    const videoId = await seedVideo();
    await recordFramePassFailure(videoId, "video too dark to read on-screen text");
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row.layout).toBeNull();
    expect(row.framePassError).toBe("video too dark to read on-screen text");
    expect(row.framePassAt).not.toBeNull();
  });

  test("preserves an existing good layout when a later pass fails", async () => {
    const videoId = await seedVideo();
    await persistFramePass({ videoId, layout: layout(), framesSampled: 12, frameModel: "claude-code/watch" });

    await recordFramePassFailure(videoId, "ffmpeg exploded on the re-run");

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(asBeatLayout(row.layout)?.[0].onScreenText.value).toBe("3 MISTAKES"); // still there
    expect(row.framePassError).toBe("ffmpeg exploded on the re-run");
    expect(row.framePassAt).not.toBeNull();
  });
});
