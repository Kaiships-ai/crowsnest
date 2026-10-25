import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { appRoot, igDir, igVenvPython, logDir, nodeBin, tsxBin } from "./runtime";

// The only macOS-coded file. Windows/Linux later is one sibling (a Windows service, a
// systemd unit) behind this same small shape: define(), load(), unload(), running().

export type Service = {
  label: string;
  program: string[];
  cwd: string;
  env: Record<string, string>;
};

const AGENTS = join(homedir(), "Library", "LaunchAgents");

/**
 * Pins CROWSNEST_DB_PATH to an absolute path under `appRoot` before this process's first
 * import of the connector secrets (which open the sqlite db at import time).
 * `@/server/db`'s own resolution is `process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db"`
 * relative to `process.cwd()`, fine for the spawned server (always `cwd: appRoot`, see
 * `services()` below) but not for the `kai` CLI binary itself, which a buyer can invoke
 * from any directory. Without this, `readSecret` below would silently open (or create) the
 * wrong database and this file's whole fix would look like it works while doing nothing.
 * Skips pinning when CROWSNEST_DB_PATH is already ":memory:" or already absolute, so
 * tests (which set ":memory:" before importing this module) are unaffected.
 */
function pinDbPathEnv(): void {
  const current = process.env.CROWSNEST_DB_PATH;
  if (current === ":memory:" || (current && isAbsolute(current))) return;
  const envPath = join(appRoot, ".env.local");
  const fromFile = existsSync(envPath) ? readFileSync(envPath, "utf8").match(/^CROWSNEST_DB_PATH=(.*)$/m)?.[1]?.trim() : undefined;
  const rel = current || fromFile || "data/crowsnest.db";
  process.env.CROWSNEST_DB_PATH = isAbsolute(rel) ? rel : join(appRoot, rel);
}
pinDbPathEnv();

/**
 * A static top-level import of the connector secrets would defeat
 * `pinDbPathEnv()` above: ES module semantics fully evaluate an imported module (and
 * its own imports, including `@/server/db`, which opens the sqlite connection at import
 * time) before *any* of this importing module's top-level code runs, regardless of
 * where the `import` line sits in this file's source. A dynamic `import()` has no such
 * hoisting: calling it inside `igEnv()` below defers loading the secrets store (and
 * opening the db) until `services()` actually runs, well after `pinDbPathEnv()` above
 * has already set `CROWSNEST_DB_PATH`. This is the same reasoning as
 * `src/server/queries/feed.test.ts` and this file's own test: a `require()` was also
 * tried and rejected because vitest's SSR `require()` cannot resolve an extensionless
 * relative `.ts` module the way `import()` can.
 */
async function sidecarSecrets() {
  const [{ readSecret }, { igSidecar }, { getOrCreateServiceToken }] = await Promise.all([
    import("../server/connectors/secrets"),
    import("../server/connectors/ig-sidecar/manifest"),
    import("../server/connectors/ig-sidecar/service-token"),
  ]);
  return { getOrCreateServiceToken, read: (name: "IG_USERNAME" | "IG_PASSWORD") => readSecret(igSidecar, name) };
}

/**
 * Env injected into the packaged sidecar's launchd job, the same shape as
 * `src/server/sidecar/control.ts`'s `childEnv()` (the dev/`uv run` launcher), ported to
 * the path a buyer's Kit install actually runs. `IG_PROXY`/`IG_DEVICE_SEED` are
 * dev-machine settings read from env only, same as `childEnv()`. Only defined
 * values are added: a credential never saved through the dashboard is simply absent from
 * this dict, leaving `crowsnest_ig/config.py`'s own `load_env_file()` free to fill it from
 * `.env.local` exactly as it does today for a `kai kit init`-only buyer who never touched
 * the dashboard.
 */
async function igEnv(): Promise<Record<string, string>> {
  const { getOrCreateServiceToken, read } = await sidecarSecrets();
  const inject: Record<string, string | undefined> = {
    IG_SERVICE_TOKEN: getOrCreateServiceToken(),
    IG_USERNAME: read("IG_USERNAME"),
    IG_PASSWORD: read("IG_PASSWORD"),
    IG_PROXY: process.env.IG_PROXY,
    IG_DEVICE_SEED: process.env.IG_DEVICE_SEED,
  };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(inject)) if (v) env[k] = v;
  return env;
}

/** The two long-lived processes: the Next server and the Instagram sidecar. */
export async function services(): Promise<Service[]> {
  return [
    {
      label: "com.crowsnest.server",
      // NODE_ENV=production + tsx server.ts, all absolute so a buyer's node is never used.
      program: [nodeBin, tsxBin, join(appRoot, "server.ts")],
      cwd: appRoot,
      // HOST binds the server to loopback so macOS never shows the "accept incoming
      // connections" firewall prompt. PORT stays the app default.
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3000" },
    },
    {
      label: "com.crowsnest.ig",
      program: [igVenvPython, "-m", "crowsnest_ig"],
      cwd: igDir,
      env: await igEnv(),
    },
  ];
}

function plistPath(label: string): string {
  return join(AGENTS, `${label}.plist`);
}

// IG_PASSWORD is an arbitrary user-chosen string (see igEnv() above) that lands
// straight in this plist's EnvironmentVariables. Unescaped, a password containing
// &, <, or > breaks the XML and launchctl bootstrap rejects the whole plist, so the
// sidecar never starts. Every value interpolated into the XML below goes through
// this first.
const xmlEscape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function plist(s: Service): string {
  const args = s.program
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join("\n");
  const env = Object.entries(s.env)
    .map(([k, v]) => `    <key>${xmlEscape(k)}</key>\n    <string>${xmlEscape(v)}</string>`)
    .join("\n");
  const out = join(logDir, `${s.label}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(s.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(s.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(out)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(out)}</string>
</dict>
</plist>
`;
}

const uid = process.getuid?.() ?? 0;

function launchctl(args: string[]): void {
  execFileSync("launchctl", args, { stdio: "ignore" });
}

/** Write both plists (idempotent) and load them. Reloads if already loaded.
 *  Async because `services()` is: `igEnv()` inside it lazily `import()`s the secrets
 *  store so it loads after `pinDbPathEnv()` has pinned `CROWSNEST_DB_PATH`, not before. */
export async function start(): Promise<void> {
  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  for (const s of await services()) {
    writeFileSync(plistPath(s.label), plist(s));
    // bootout first so a changed plist (new version dir) takes effect, ignore if not loaded.
    try {
      launchctl(["bootout", `gui/${uid}/${s.label}`]);
    } catch {
      // not loaded yet
    }
    launchctl(["bootstrap", `gui/${uid}`, plistPath(s.label)]);
  }
}

export async function stop(): Promise<void> {
  for (const s of await services()) {
    try {
      launchctl(["bootout", `gui/${uid}/${s.label}`]);
    } catch {
      // already stopped
    }
  }
}

/** True if launchd currently has the label loaded. */
export function running(label: string): boolean {
  try {
    execFileSync("launchctl", ["print", `gui/${uid}/${label}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function installed(label: string): boolean {
  return existsSync(plistPath(label));
}
