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

  it("starts no publish, sync or measure timer when LEAD_STUDIO_PRIMARY is unset", () => {
    stop = startInApp({ migrationsFolder, env: {} });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses Graph and sidecar fetches when LEAD_STUDIO_PRIMARY is unset", async () => {
    stop = startInApp({ migrationsFolder, env: {} });
    await expect(fetch("https://graph.instagram.com/me")).rejects.toThrow("not the primary writer");
    await expect(fetch("http://127.0.0.1:8765/health")).rejects.toThrow("not the primary writer");
  });

  it("starts the publish, sync and measure timers when LEAD_STUDIO_PRIMARY=1", () => {
    stop = startInApp({ migrationsFolder, env: { LEAD_STUDIO_PRIMARY: "1" } });
    expect(vi.getTimerCount()).toBe(4);
  });
});
