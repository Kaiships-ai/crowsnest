import { spawn } from "node:child_process";

/**
 * Stage 2 transport for the frame pass. Spawns the local Claude Code CLI in print mode
 * and returns whatever text it produced.
 *
 * The tool allowlist is the security boundary of this whole feature. With
 * `--allowedTools Read` the child can open the files we name and nothing else: no shell,
 * no writes, no database handle. Widening this default is a security decision, not a
 * convenience one.
 *
 * Deliberately knows nothing about videos, frames or layouts. It is a function from a
 * prompt to text, which is the seam a second consumer would reuse.
 */
export class ClaudeTaskError extends Error {}

export interface ClaudeTaskResult {
  text: string;
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
}

/**
 * Absolute on purpose. `claude` on PATH here is a cmux shim that exits with
 * "claude not found in PATH", so resolving from PATH fails in a confusing way.
 */
const DEFAULT_BINARY = "/Users/kienbeovl/.local/bin/claude";

export async function runClaudeTask(
  prompt: string,
  opts: { binaryPath?: string; model?: string; allowedTools?: string[]; timeoutMs?: number } = {}
): Promise<ClaudeTaskResult> {
  const binary = opts.binaryPath ?? process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;

  const allowedTools = opts.allowedTools ?? ["Read"];
  if (allowedTools.length === 0) {
    throw new ClaudeTaskError(
      "allowedTools must not be empty: --allowedTools has no way to express \"zero tools\", and omitting the " +
        "flag would silently fall back to the CLI's default permissions, which is wider than what was asked for."
    );
  }

  // --allowedTools is variadic on the real CLI: it greedily consumes every token that
  // follows until the next recognized flag. It must be the LAST thing in argv, after
  // --output-format json, or it swallows those two tokens as if they were tool names.
  const args = [
    "-p",
    prompt,
    "--model",
    opts.model ?? "sonnet",
    "--output-format",
    "json",
    "--allowedTools",
    ...allowedTools,
  ];

  const { stdout, stderr, code } = await run(binary, args, opts.timeoutMs ?? 600_000);

  if (code !== 0) {
    throw new ClaudeTaskError(
      `claude exited with code ${code}: stdout=${stdout.trim().slice(0, 300)} stderr=${stderr.trim().slice(0, 300)}`
    );
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new ClaudeTaskError(
      `claude did not return a JSON envelope (exit ${code}): stdout=${stdout.trim().slice(0, 300)} stderr=${stderr.trim().slice(0, 300)}`
    );
  }
  if (envelope.is_error) {
    throw new ClaudeTaskError(`claude reported an error: ${String(envelope.result ?? "").slice(0, 300)}`);
  }

  return {
    text: String(envelope.result ?? ""),
    costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
    turns: typeof envelope.num_turns === "number" ? envelope.num_turns : null,
    durationMs: typeof envelope.duration_ms === "number" ? envelope.duration_ms : null,
  };
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ClaudeTaskError(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new ClaudeTaskError(`could not run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
