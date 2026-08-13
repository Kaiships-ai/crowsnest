import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn(() => ({ onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() }));
vi.mock("node-pty", () => ({ spawn }));

describe("createTerminalSession", () => {
  it("spawns the claude binary with bypass, the given cwd, and a scrubbed env", async () => {
    process.env.CLAUDE_CODE_CHILD_SESSION = "parent-marker";
    process.env.SOME_TOKEN = "secret";
    const { createTerminalSession } = await import("./session");
    createTerminalSession({ cwd: "/tmp/sandbox" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, ptyOpts] = spawn.mock.calls[0];
    expect(bin).toMatch(/claude$/);
    expect(args).toContain("--dangerously-skip-permissions");
    expect(ptyOpts.cwd).toBe("/tmp/sandbox");
    expect(ptyOpts.env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(ptyOpts.env.SOME_TOKEN).toBeUndefined();
  });
});
