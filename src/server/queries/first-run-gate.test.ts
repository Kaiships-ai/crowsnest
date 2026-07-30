import { beforeAll, describe, expect, test } from "vitest";

// `first-run-gate.ts` imports `../db` at module scope, which loads `../config` and
// throws on an incomplete env — same reason `settings/index.test.ts` sets these before
// its first import rather than at the top of the file.
let shouldRedirectToFirstRun: typeof import("./first-run-gate")["shouldRedirectToFirstRun"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ shouldRedirectToFirstRun } = await import("./first-run-gate"));
});

describe("shouldRedirectToFirstRun", () => {
  test("a truly fresh install (no flag, no channels) redirects", () => {
    expect(shouldRedirectToFirstRun({ firstRunCompleted: false, hasChannels: false })).toBe(true);
  });

  test("a database that already has channels never redirects, even with the flag unset", () => {
    // Protects an existing seeded dev database, or one that predates this flag, from
    // suddenly being dropped into onboarding on every route.
    expect(shouldRedirectToFirstRun({ firstRunCompleted: false, hasChannels: true })).toBe(false);
  });

  test("once the flag is set, never redirects again, even with zero channels", () => {
    // Removing every channel after finishing first run must not re-trigger onboarding.
    expect(shouldRedirectToFirstRun({ firstRunCompleted: true, hasChannels: false })).toBe(false);
  });

  test("completed and populated: never redirects", () => {
    expect(shouldRedirectToFirstRun({ firstRunCompleted: true, hasChannels: true })).toBe(false);
  });
});
