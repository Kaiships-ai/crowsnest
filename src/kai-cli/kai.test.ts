import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { appRoot } from "./runtime";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(() => ({ unref: vi.fn() })) };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readlinkSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    symlinkSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return { ...actual, isBundle: true };
});

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readlinkSync, statSync } from "node:fs";

import { ask, checkPairedIgCreds, closeIo, cmdRollback, DEFAULT_INSTALL_URL } from "./kai";

afterEach(() => {
  closeIo();
});

/** A fake terminal: a PassThrough that looks like a TTY to `ask()`. */
function fakeTty(): PassThrough & { isTTY: boolean; setRawMode: (mode: boolean) => void } {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (mode: boolean) => void };
  stream.isTTY = true;
  stream.setRawMode = () => {};
  return stream;
}

function collect(stream: PassThrough): () => string {
  let buf = "";
  stream.on("data", (chunk) => (buf += chunk.toString()));
  return () => buf;
}

describe("ask", () => {
  test("secret on a real terminal: reads the password and echoes nothing", async () => {
    const input = fakeTty();
    const output = new PassThrough();
    const written = collect(output);

    const promise = ask("IG_PASSWORD", { secret: true, input, output });
    input.write("hunter2\r");

    await expect(promise).resolves.toBe("hunter2");
    expect(written()).not.toContain("hunter2");
  });

  test("secret over a pipe (non-TTY) still returns the line via the normal path", async () => {
    const input = new PassThrough(); // no isTTY -> not a real terminal
    const output = new PassThrough();

    const promise = ask("IG_PASSWORD", { secret: true, input, output });
    input.write("hunter2\n");

    await expect(promise).resolves.toBe("hunter2");
  });

  test("non-secret piped input returns the line", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const promise = ask("IG_USERNAME", { input, output });
    input.write("alice\n");

    await expect(promise).resolves.toBe("alice");
  });

  test("falls back when the line is blank", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const promise = ask("PROMPT", { fallback: "/default", input, output });
    input.write("\n");

    await expect(promise).resolves.toBe("/default");
  });
});

describe("checkPairedIgCreds", () => {
  test("both blank is fine", () => {
    expect(checkPairedIgCreds("", "")).toBeNull();
  });

  test("both set is fine", () => {
    expect(checkPairedIgCreds("alice", "hunter2")).toBeNull();
  });

  test("username without password is refused", () => {
    const err = checkPairedIgCreds("alice", "");
    expect(err).toMatch(/IG_USERNAME and IG_PASSWORD must be set together/);
  });

  test("password without username is refused", () => {
    const err = checkPairedIgCreds("", "hunter2");
    expect(err).toMatch(/IG_USERNAME and IG_PASSWORD must be set together/);
  });
});

describe("cmdUpdate install URL (KIT-3)", () => {
  test("defaults to the gate's install.sh, matching install.sh.template", () => {
    expect(DEFAULT_INSTALL_URL).toBe("https://crowsnest-gate.kaiships.workers.dev/install.sh");
  });
});

describe("cmdRollback", () => {
  const appsDir = join(homedir(), ".kai", "app");
  const currentLink = join(appsDir, "current");
  const newVersionDir = join(appsDir, "v2.0.0");
  const oldVersionDir = join(appsDir, "v1.0.0");

  afterEach(() => {
    vi.mocked(spawn).mockClear();
    vi.mocked(existsSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readlinkSync).mockReset();
    vi.mocked(statSync).mockReset();
    vi.restoreAllMocks();
  });

  test("spawns a fresh `kai _postupdate` process from the new version's bin, instead of running post-update in-process", () => {
    vi.mocked(readlinkSync).mockReturnValue(newVersionDir as unknown as string);
    vi.mocked(readdirSync).mockReturnValue(["v2.0.0", "v1.0.0"] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockImplementation((p) => p === currentLink);

    cmdRollback();

    // Rolled back to the OTHER version (v1.0.0), whose own bin must run post-update -
    // not the still-running process's bin, which is still pinned to v2.0.0.
    const expectedBin = join(oldVersionDir, "bin", "kai");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(expectedBin, ["_postupdate"], expect.objectContaining({ detached: true }));
  });

  test("refuses to spawn anything when the two versions' migrations differ", () => {
    vi.mocked(readlinkSync).mockReturnValue(newVersionDir as unknown as string);
    vi.mocked(readdirSync).mockImplementation((p) => {
      if (p === appsDir) return ["v2.0.0", "v1.0.0"] as unknown as ReturnType<typeof readdirSync>;
      if (p === join(newVersionDir, "app", "drizzle")) return ["0002_new.sql"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockImplementation(
      (p) => p === currentLink || p === join(newVersionDir, "app", "drizzle"),
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit(1)");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => cmdRollback()).toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Refusing to roll back"));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(spawn).not.toHaveBeenCalled();
  });
});

// This suite runs `kai` as a real subprocess, invoked directly (not imported), from a
// foreign cwd -- vi.mock and vitest's own module graph can't fake the OS-level cwd a
// real tsx process boots with, which is what the bug and its fix are both about.
//
// The bug: tsx resolves `@/`-aliased imports (like "@/server/db") against a project
// root it locates once, before any of the entry script's own code runs -- confirmed by
// hand, before this fix existed, with a throwaway script whose *first statement* was
// `process.chdir(appRoot)`, before any import at all: `import("@/server/db")` still
// failed with "Cannot find module '@/server/db'" later in that same script. A plain
// `process.chdir()` inside kai.ts cannot fix this; only a real process respawn can,
// which is what kai.ts now does (see the `isMain && process.cwd() !== REPO` block near
// its top) when it detects it wasn't started from appRoot.
describe("kai.ts respawns from appRoot when invoked from elsewhere, so @/-aliased imports resolve", () => {
  test("`kai status` from a foreign cwd resolves @/server/db instead of crashing on module resolution", () => {
    const tsxBinPath = join(appRoot, "node_modules", ".bin", "tsx");
    const scratch = mkdtempSync(join(tmpdir(), "kai-cwd-"));
    const scratchDb = join(scratch, "scratch.db");

    try {
      // A throwaway, migrated db (isolated from the real dev db) so the command
      // reaches all the way through services() -> igEnv() -> getOrCreateServiceToken()
      // without an unrelated "no such table" error masking what this test checks.
      execFileSync(tsxBinPath, [join(appRoot, "src", "server", "db", "migrate.ts")], {
        cwd: appRoot,
        env: { ...process.env, CROWSNEST_DB_PATH: scratchDb },
      });

      const out = execFileSync(tsxBinPath, [join(appRoot, "src", "kai-cli", "kai.ts"), "status"], {
        cwd: scratch, // a directory with no ancestor relationship to appRoot
        env: { ...process.env, CROWSNEST_DB_PATH: scratchDb },
        encoding: "utf8",
      });

      expect(out).not.toContain("Cannot find module");
      expect(out).toMatch(/com\.crowsnest\.server: (running|stopped|not installed)/);
      expect(out).toMatch(/com\.crowsnest\.ig: (running|stopped|not installed)/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 20_000);
});
