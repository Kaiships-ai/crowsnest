import { homedir } from "node:os";
import { join } from "node:path";
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
const DEFAULT_BINARY = join(homedir(), ".local", "bin", "claude");

export interface ClaudeTaskOpts {
  binaryPath?: string;
  model?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  cwd?: string;
  addDirs?: string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * A copy of `base` with anything that looks like a credential removed. The frame-pass
 * child only has Read, but it should never even see IG_PASSWORD, a token, or the db path
 * in its environment. Keeps PATH, HOME and the rest so the CLI still runs and authenticates
 * from ~/.claude.
 */
export function scrubClaudeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const SENSITIVE = /(TOKEN|SECRET|PASSWORD|_KEY$|SESSIONID|CROWSNEST_DB_PATH|DATABASE_URL)/i;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (SENSITIVE.test(k)) continue;
    out[k] = v;
  }
  // Next declares NODE_ENV as required on ProcessEnv, and a key-by-key copy cannot prove
  // to the compiler that it kept it. It does: NODE_ENV is not sensitive, so it survives.
  return out as NodeJS.ProcessEnv;
}

export function buildClaudeInvocation(
  prompt: string,
  opts: ClaudeTaskOpts = {}
): { binary: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv } {
  const binary = opts.binaryPath ?? process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;
  const allowedTools = opts.allowedTools ?? ["Read"];
  if (allowedTools.length === 0) {
    throw new ClaudeTaskError(
      "allowedTools must not be empty: --allowedTools has no way to express \"zero tools\", and omitting the " +
        "flag would silently fall back to the CLI's default permissions, which is wider than what was asked for."
    );
  }
  const addDirArgs = (opts.addDirs ?? []).flatMap((d) => ["--add-dir", d]);
  // --allowedTools is variadic: it greedily consumes every following token. It stays LAST,
  // after --output-format json and any --add-dir pairs, or it swallows them as tool names.
  const args = [
    "-p",
    prompt,
    "--model",
    opts.model ?? "sonnet",
    "--output-format",
    "json",
    ...addDirArgs,
    "--allowedTools",
    ...allowedTools,
  ];
  return { binary, args, cwd: opts.cwd, env: opts.env ?? scrubClaudeEnv() };
}

export async function runClaudeTask(prompt: string, opts: ClaudeTaskOpts = {}): Promise<ClaudeTaskResult> {
  const { binary, args, cwd, env } = buildClaudeInvocation(prompt, opts);

  const { stdout, stderr, code } = await run(binary, args, opts.timeoutMs ?? 600_000, { cwd, env });

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
  timeoutMs: number,
  spawnOpts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: spawnOpts.cwd, env: spawnOpts.env });
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
