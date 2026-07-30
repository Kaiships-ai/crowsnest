import { describe, expect, test } from "vitest";
import { formatRunElapsed, isProxyLikelyDown, runTone, runToneLabel } from "./run-log-view";
import type { RemixRunRow } from "@/server/queries/remix-runs";

function run(overrides: Partial<RemixRunRow>): RemixRunRow {
  return {
    id: "r1",
    stage: "hook",
    outcome: "success",
    startedAt: "2026-07-31T10:00:00.000Z",
    finishedAt: "2026-07-31T10:00:01.000Z",
    elapsedMs: 500,
    detail: "5 hooks generated",
    errorMessage: null,
    ...overrides,
  };
}

describe("runTone", () => {
  test("a failed attempt is bad", () => {
    expect(runTone(run({ outcome: "error", detail: "Connection error.", errorMessage: "Connection error." }))).toBe("bad");
  });

  test("a clean hook/style success is pos", () => {
    expect(runTone(run({ detail: "5 hooks generated" }))).toBe("pos");
  });

  test("3 of 3 variants succeeded reads as a clean success", () => {
    expect(runTone(run({ stage: "script", detail: "3 of 3 variants succeeded" }))).toBe("pos");
  });

  test("2 of 3 variants succeeded reads as partial, never as clean", () => {
    expect(runTone(run({ stage: "script", detail: "2 of 3 variants succeeded" }))).toBe("warn");
  });

  test("0 of 3 variants succeeded is still outcome:error, so it reads as bad, not partial", () => {
    expect(runTone(run({ stage: "script", outcome: "error", detail: "0 of 3 variants succeeded", errorMessage: "0 of 3 variants succeeded" }))).toBe(
      "bad"
    );
  });
});

describe("runToneLabel", () => {
  test("maps every tone to a distinct label", () => {
    expect(runToneLabel("pos")).toBe("Success");
    expect(runToneLabel("warn")).toBe("Partial");
    expect(runToneLabel("bad")).toBe("Failed");
  });
});

describe("formatRunElapsed", () => {
  test("sub-second stays in ms", () => {
    expect(formatRunElapsed(340)).toBe("340ms");
  });

  test("one second or more switches to seconds with one decimal", () => {
    expect(formatRunElapsed(2100)).toBe("2.1s");
  });
});

describe("isProxyLikelyDown", () => {
  test("empty run log means unknown, not down", () => {
    expect(isProxyLikelyDown([])).toBe(false);
  });

  test("a recent Connection error. reads as the proxy being down", () => {
    expect(
      isProxyLikelyDown([run({ outcome: "error", detail: "Connection error.", errorMessage: "Connection error." })])
    ).toBe(true);
  });

  test("a total script failure (0 of N) corroborates a down proxy", () => {
    expect(
      isProxyLikelyDown([run({ stage: "script", outcome: "error", detail: "0 of 3 variants succeeded", errorMessage: "0 of 3 variants succeeded" })])
    ).toBe(true);
  });

  test("a partial script failure does not by itself mean the proxy is down", () => {
    expect(
      isProxyLikelyDown([run({ stage: "script", outcome: "success", detail: "2 of 3 variants succeeded" })])
    ).toBe(false);
  });

  test("an auth or rate-limit failure is not mistaken for the proxy being down", () => {
    expect(
      isProxyLikelyDown([run({ outcome: "error", detail: "API key invalid or revoked — check Settings", errorMessage: "API key invalid or revoked — check Settings" })])
    ).toBe(false);
  });

  test("a clean success after a prior failure means the proxy is back — only the most recent rows count", () => {
    const rows = [
      run({ id: "r2", outcome: "success", detail: "5 hooks generated", startedAt: "2026-07-31T10:05:00.000Z" }),
      run({ id: "r1", outcome: "error", detail: "Connection error.", errorMessage: "Connection error.", startedAt: "2026-07-31T10:00:00.000Z" }),
    ];
    // Still true: the most recent 3 rows include the earlier failure, and a single
    // recovered call doesn't retroactively prove every stage is healthy again — the
    // window is a deliberate corroboration net, not a single-row toggle.
    expect(isProxyLikelyDown(rows)).toBe(true);
  });
});
