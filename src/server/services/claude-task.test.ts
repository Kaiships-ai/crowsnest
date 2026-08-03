import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaudeTask, ClaudeTaskError } from "./claude-task";

let dir: string;

/** A stand-in for the real CLI: prints one canned --output-format json envelope. */
function fakeBinary(name: string, body: string, exitCode = 0): string {
  const p = path.join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\ncat <<'EOF'\n${body}\nEOF\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

/**
 * Same as fakeBinary, but also dumps its own argv (one token per line) to a sidecar
 * file so a test can assert on flag ORDER, not just presence.
 */
function fakeBinaryCapturingArgv(
  name: string,
  body: string,
  exitCode = 0
): { bin: string; readArgv: () => string[] } {
  const bin = path.join(dir, name);
  const argvFile = path.join(dir, `${name}.argv`);
  writeFileSync(
    bin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\ncat <<'EOF'\n${body}\nEOF\nexit ${exitCode}\n`
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    readArgv: () => readFileSync(argvFile, "utf8").split("\n").filter(Boolean),
  };
}

/** A binary that sleeps well past any reasonable test timeout before it would answer. */
function sleepingBinary(name: string, sleepSeconds: number): string {
  const p = path.join(dir, name);
  writeFileSync(
    p,
    `#!/usr/bin/env bash\nsleep ${sleepSeconds}\ncat <<'EOF'\n${JSON.stringify({ is_error: false, result: "too late" })}\nEOF\nexit 0\n`
  );
  chmodSync(p, 0o755);
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "claude-task-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

afterEach(() => {
  delete process.env.CLAUDE_BINARY_PATH;
});

describe("runClaudeTask", () => {
  test("returns the result text and the usage numbers from the envelope", async () => {
    const bin = fakeBinary(
      "ok",
      JSON.stringify({ is_error: false, result: "hello", total_cost_usd: 0.25, num_turns: 3, duration_ms: 900 })
    );
    const out = await runClaudeTask("say hello", { binaryPath: bin });
    expect(out.text).toBe("hello");
    expect(out.costUsd).toBe(0.25);
    expect(out.turns).toBe(3);
  });

  test("throws when the envelope reports is_error", async () => {
    const bin = fakeBinary("err", JSON.stringify({ is_error: true, result: "rate limited" }));
    await expect(runClaudeTask("x", { binaryPath: bin })).rejects.toThrow(ClaudeTaskError);
  });

  test("throws when stdout is not the JSON envelope at all", async () => {
    const bin = fakeBinary("junk", "not json");
    await expect(runClaudeTask("x", { binaryPath: bin })).rejects.toThrow(ClaudeTaskError);
  });

  test("throws a clear error when the binary does not exist", async () => {
    await expect(runClaudeTask("x", { binaryPath: path.join(dir, "nope") })).rejects.toThrow(ClaudeTaskError);
  });

  test("rejects with ClaudeTaskError when the process exceeds timeoutMs, and does not hang", async () => {
    const bin = sleepingBinary("slow", 5);
    await expect(runClaudeTask("x", { binaryPath: bin, timeoutMs: 50 })).rejects.toThrow(ClaudeTaskError);
  });

  test("puts --allowedTools after --output-format json, with every entry reaching argv", async () => {
    const { bin, readArgv } = fakeBinaryCapturingArgv(
      "argv-order",
      JSON.stringify({ is_error: false, result: "ok" })
    );
    await runClaudeTask("hello", { binaryPath: bin, allowedTools: ["Read", "Grep"] });
    const argv = readArgv();
    const outputFormatIdx = argv.indexOf("--output-format");
    const allowedToolsIdx = argv.indexOf("--allowedTools");
    expect(outputFormatIdx).toBeGreaterThanOrEqual(0);
    expect(allowedToolsIdx).toBeGreaterThan(outputFormatIdx);
    expect(argv.slice(allowedToolsIdx + 1)).toEqual(["Read", "Grep"]);
  });

  test("throws when allowedTools is explicitly empty, instead of widening permissions silently", async () => {
    await expect(
      runClaudeTask("x", { binaryPath: path.join(dir, "unused-because-it-should-never-spawn"), allowedTools: [] })
    ).rejects.toThrow(ClaudeTaskError);
  });

  test("falls back to CLAUDE_BINARY_PATH when opts.binaryPath is not given", async () => {
    const bin = fakeBinary("env-bin", JSON.stringify({ is_error: false, result: "from env" }));
    process.env.CLAUDE_BINARY_PATH = bin;
    const out = await runClaudeTask("x");
    expect(out.text).toBe("from env");
  });

  test("passes a custom model to argv", async () => {
    const { bin, readArgv } = fakeBinaryCapturingArgv(
      "model-argv",
      JSON.stringify({ is_error: false, result: "ok" })
    );
    await runClaudeTask("hi", { binaryPath: bin, model: "opus" });
    const argv = readArgv();
    const modelIdx = argv.indexOf("--model");
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(argv[modelIdx + 1]).toBe("opus");
  });

  test("returns durationMs from the envelope", async () => {
    const bin = fakeBinary("duration", JSON.stringify({ is_error: false, result: "ok", duration_ms: 1234 }));
    const out = await runClaudeTask("x", { binaryPath: bin });
    expect(out.durationMs).toBe(1234);
  });
});
