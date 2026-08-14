import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/config", () => ({ config: { WORKSPACE_ROOT: "/data/workspace" } }));
import { slugify, sandboxDir, rendersDir, rendersRoot } from "./paths";

describe("studio paths", () => {
  it("slugifies a title to a safe slug", () => {
    expect(slugify("7 Free AI Tools nobody uses!")).toBe("7-free-ai-tools-nobody-uses");
    expect(slugify("  spaced  --  out  ")).toBe("spaced-out");
  });
  it("builds the per-post sandbox and renders dirs under the workspace root", () => {
    expect(sandboxDir("7-free-ai-tools")).toBe("/data/workspace/videos/7-free-ai-tools");
    expect(rendersDir("2026-08-12", "7-free-ai-tools")).toBe("/data/workspace/renders/2026-08-12-7-free-ai-tools");
  });
  it("exposes the shared renders root", () => {
    expect(rendersRoot()).toBe("/data/workspace/renders");
  });
});
