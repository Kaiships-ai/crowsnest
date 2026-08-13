// src/server/terminal/render-watch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rendersRoot = () => path.join(vaultDir, "Studio", "workspace", "renders");
let vaultDir: string;

vi.mock("@/server/config", () => ({ config: { get VAULT_PATH() { return vaultDir; } } }));

let watchForRender: typeof import("./render-watch")["watchForRender"];
let pruneOldRenders: typeof import("./render-watch")["pruneOldRenders"];
beforeEach(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), "render-watch-"));
  mkdirSync(rendersRoot(), { recursive: true });
  ({ watchForRender, pruneOldRenders } = await import("./render-watch"));
});
afterEach(() => { rmSync(vaultDir, { recursive: true, force: true }); vi.resetModules(); });

describe("watchForRender", () => {
  it("fires onFound once when this slug's video.mp4 lands and its size is stable", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-my-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await vi.waitFor(() => expect(onFound).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onFound.mock.calls[0][0]).toBe(path.join(dir, "video.mp4"));
    handle.stop();
  });

  it("ignores a video.mp4 for a different slug", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-other-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await new Promise((r) => setTimeout(r, 1600));
    expect(onFound).not.toHaveBeenCalled();
    handle.stop();
  });
});

describe("pruneOldRenders", () => {
  it("removes only dirs older than maxAgeMs, in a root passed explicitly", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prune-root-"));
    const oldDir = path.join(root, "2026-08-01-old-post");
    const freshDir = path.join(root, "2026-08-13-fresh-post");
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });

    const now = Date.now();
    const oldMtime = new Date(now - 2 * 60 * 60 * 1000); // 2h old
    const freshMtime = new Date(now - 60 * 1000); // 1min old
    utimesSync(oldDir, oldMtime, oldMtime);
    utimesSync(freshDir, freshMtime, freshMtime);

    pruneOldRenders(root, 60 * 60 * 1000, now); // 1h max age

    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it("does not throw when the root does not exist", () => {
    const missingRoot = path.join(vaultDir, "does-not-exist");
    expect(() => pruneOldRenders(missingRoot, 60 * 60 * 1000)).not.toThrow();
  });
});
