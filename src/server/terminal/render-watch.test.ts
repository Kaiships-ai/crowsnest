// src/server/terminal/render-watch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rendersRoot = () => path.join(vaultDir, "Studio", "workspace", "renders");
let vaultDir: string;

vi.mock("@/server/config", () => ({ config: { get VAULT_PATH() { return vaultDir; } } }));

let watchForRender: typeof import("./render-watch")["watchForRender"];
beforeEach(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), "render-watch-"));
  mkdirSync(rendersRoot(), { recursive: true });
  ({ watchForRender } = await import("./render-watch"));
});
afterEach(() => { rmSync(vaultDir, { recursive: true, force: true }); vi.resetModules(); });

describe("watchForRender", () => {
  it("fires onFound once when this slug's video.mp4 lands and its size is stable", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-my-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await vi.waitFor(() => expect(onFound).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect(onFound.mock.calls[0][0]).toBe(path.join(dir, "video.mp4"));
    handle.stop();
  }, 12000);

  it("ignores a video.mp4 for a different slug", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-other-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await new Promise((r) => setTimeout(r, 1200));
    expect(onFound).not.toHaveBeenCalled();
    handle.stop();
  });
});
