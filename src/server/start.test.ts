import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, tables } from "./db";
import { getSecret } from "./secrets/store";
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

  it("moves legacy plaintext secrets into the keychain on boot", () => {
    stop = startInApp({ migrationsFolder, env: {} });
    stop();
    db.insert(tables.secrets).values({ name: "IG_GRAPH_TOKEN", value: "boot-plain-token", updatedAt: "2026-01-01T00:00:00.000Z" }).run();
    stop = startInApp({ migrationsFolder, env: {} });
    expect(db.select().from(tables.secrets).all()).toEqual([]);
    expect(getSecret("IG_GRAPH_TOKEN")).toBe("boot-plain-token");
  });
});
