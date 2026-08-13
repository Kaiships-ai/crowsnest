import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn((_file: string, _args: string[], _opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => ({
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("node-pty", () => ({ spawn }));

describe("createTerminalSession", () => {
  it("spawns with the profile's argv, cwd, and env", async () => {
    const { createTerminalSession } = await import("./session");
    const profile = {
      cwd: "/tmp/sandbox",
      permissionMode: "bypassPermissions" as const,
      settingsJson: '{"hooks":{"SessionStart":[]}}',
      env: { FOO: "bar" } as unknown as NodeJS.ProcessEnv,
    };
    createTerminalSession(profile);
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["--permission-mode", "bypassPermissions", "--settings", '{"hooks":{"SessionStart":[]}}'],
      expect.objectContaining({ cwd: "/tmp/sandbox", env: { FOO: "bar" } }),
    );
  });

  it("uses the claude binary", async () => {
    const { createTerminalSession } = await import("./session");
    createTerminalSession({
      cwd: "/tmp/sandbox",
      permissionMode: "bypassPermissions" as const,
      settingsJson: "{}",
      env: {} as NodeJS.ProcessEnv,
    });
    const [bin] = spawn.mock.calls[spawn.mock.calls.length - 1];
    expect(bin).toMatch(/claude$/);
  });

  it("kills the process group, falling back to child.kill() on error", async () => {
    const { createTerminalSession } = await import("./session");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const session = createTerminalSession({
      cwd: "/tmp/sandbox",
      permissionMode: "bypassPermissions" as const,
      settingsJson: "{}",
      env: {} as NodeJS.ProcessEnv,
    });
    const child = spawn.mock.results[spawn.mock.results.length - 1].value;
    Object.defineProperty(child, "pid", { value: 4242, configurable: true });

    session.kill();

    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);

    killSpy.mockRestore();
  });
});
