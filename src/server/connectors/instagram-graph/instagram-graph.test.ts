import { expect, test, vi } from "vitest";
import type { MeasureResult } from "@/server/services/own-measure";

const measureOwnChannel = vi.hoisted(() => vi.fn<() => Promise<MeasureResult>>());
vi.mock("@/server/services/own-measure", () => ({ measureOwnChannel }));

const { connector } = await import("./index");

const run = { ok: true, measuredAt: "2026-10-18T05:00:00.000Z", postsSeen: 12, postsMeasured: 12, postsFailed: 0, commentsSeen: 3, partial: false, callsUsed: 30, stoppedEarly: null, limitedByRecentCalls: false } as const;

test.each<[string, MeasureResult, object]>([
  ["every post measured", run, { kind: "complete" }],
  ["a post whose insights failed", { ...run, postsMeasured: 10, postsFailed: 2 }, { kind: "partial", missing: "insights for 2 of 12 posts", reason: "a call failed" }],
  ["comments that failed after the posts", { ...run, partial: true }, { kind: "partial", missing: "comments or breakdowns", reason: "a call failed" }],
  ["a run the hourly budget stopped", { ...run, postsMeasured: 4, stoppedEarly: "budget" }, { kind: "partial", missing: "posts left after the run stopped", reason: "hourly call budget" }],
  ["a dead token", { ok: false, error: "token expired", code: "GRAPH_AUTH_FAILED" }, { kind: "failed", reason: "token expired" }],
])("the daily pull reports %s", async (_label, result, expected) => {
  measureOwnChannel.mockResolvedValueOnce(result);
  expect(await connector.adapter?.pull?.()).toMatchObject(expected);
});
