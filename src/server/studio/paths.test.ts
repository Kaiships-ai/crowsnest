import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/config", () => ({ config: { VAULT_PATH: "/vault" } }));
import { slugify, sandboxDir, rendersDir } from "./paths";

describe("studio paths", () => {
  it("slugifies a title to a safe slug", () => {
    expect(slugify("7 Free AI Tools nobody uses!")).toBe("7-free-ai-tools-nobody-uses");
    expect(slugify("  spaced  --  out  ")).toBe("spaced-out");
  });
  it("builds the per-post sandbox and renders dirs under the vault", () => {
    expect(sandboxDir("7-free-ai-tools")).toBe("/vault/Studio/workspace/videos/7-free-ai-tools");
    expect(rendersDir("2026-08-12", "7-free-ai-tools")).toBe("/vault/Studio/workspace/renders/2026-08-12-7-free-ai-tools");
  });
});
