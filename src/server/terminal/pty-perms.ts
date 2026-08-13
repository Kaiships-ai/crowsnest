import { chmodSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const FILES = ["pty.node", "spawn-helper"];

export function ensurePtyExecutable(prebuildsDir = defaultPrebuildsDir()): void {
  if (!existsSync(prebuildsDir)) return;
  for (const f of FILES) {
    const p = path.join(prebuildsDir, f);
    if (!existsSync(p)) continue;
    const mode = statSync(p).mode;
    if ((mode & 0o111) === 0) chmodSync(p, mode | 0o755);
  }
}

function defaultPrebuildsDir(): string {
  // darwin-arm64 prebuild dir inside node-pty
  return path.join(process.cwd(), "node_modules", "node-pty", "prebuilds", "darwin-arm64");
}
