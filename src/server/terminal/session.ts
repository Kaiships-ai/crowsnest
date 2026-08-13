import { spawn } from "node-pty";
import { scrubClaudeEnv } from "../services/claude-task";
import { buildHarnessArgs, type HarnessProfile } from "./harness-profile";

/**
 * Absolute on purpose, same reasoning as claude-task.ts's DEFAULT_BINARY: `claude` on PATH
 * here is a cmux shim, so resolving from PATH fails in a confusing way.
 */
const DEFAULT_BINARY = "/Users/kienbeovl/.local/bin/claude";

export interface TerminalSession {
  onData(cb: (s: string) => void): void;
  write(s: string): void;
  resize(cols: number, rows: number): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

/**
 * scrubClaudeEnv already strips credential-looking keys. On top of that, this deletes every
 * CLAUDE_CODE_* key: the spike found the child otherwise inherits this session's
 * CLAUDE_CODE_CHILD_SESSION marker and mis-fires a SessionStart hook.
 */
export function scrubbedTerminalEnv(): NodeJS.ProcessEnv {
  const out = scrubClaudeEnv();
  for (const k of Object.keys(out)) {
    if (/^CLAUDE_CODE_/.test(k)) delete out[k];
  }
  return out;
}

export function createTerminalSession(profile: HarnessProfile): TerminalSession {
  const binary = process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;
  const child = spawn(binary, buildHarnessArgs(profile), {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: profile.cwd,
    env: profile.env,
  });

  return {
    onData(cb) {
      child.onData(cb);
    },
    write(s) {
      child.write(s);
    },
    resize(cols, rows) {
      child.resize(cols, rows);
    },
    onExit(cb) {
      child.onExit(({ exitCode }) => cb(exitCode));
    },
    kill() {
      const pid = child.pid;
      if (typeof pid === "number") {
        try {
          // Negative pid signals the whole process group so ffmpeg/kokoro/sub-agent
          // children die with the cook, not orphaned. On darwin the pty child leads
          // its own session, so its pid is its pgid.
          process.kill(-pid, "SIGTERM");
          return;
        } catch {
          // ESRCH (group already gone) or EPERM: fall through to the single kill.
        }
      }
      child.kill();
    },
  };
}
