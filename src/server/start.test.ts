import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startInApp } from "./start";

const migrationsFolder = "./drizzle";

describe("startInApp", () => {
  let stop: () => void = () => {};
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("starts sync and own-measure but not the publish timer when LEAD_STUDIO_PUBLISH_JOBS is unset", () => {
    stop = startInApp({ migrationsFolder, env: {} });
    expect(vi.getTimerCount()).toBe(3);
  });

  it("leaves fetch alone, so sync and measure can reach Instagram", () => {
    const before = globalThis.fetch;
    stop = startInApp({ migrationsFolder, env: {} });
    expect(globalThis.fetch).toBe(before);
  });

  it("also starts the publish timer when LEAD_STUDIO_PUBLISH_JOBS=1", () => {
    stop = startInApp({ migrationsFolder, env: { LEAD_STUDIO_PUBLISH_JOBS: "1" } });
    expect(vi.getTimerCount()).toBe(4);
  });
});
