#!/usr/bin/env -S npx tsx
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";

import { LicenseError, entitlementPath, login, readEntitlement } from "./license";
import {
  appRoot as REPO,
  isBundle,
  logDir,
  nodeBin,
  tsxBin,
  uvBin,
  igDir,
  igVenvPython,
  wheelhouse,
} from "./runtime";
import * as svc from "./service-darwin";
import {
  claudeCodeAddArgs,
  claudeDesktopConfigPath,
  claudeDesktopJson,
  codexConfigPath,
  genericMcpJson,
  probeMcp,
  registerClaudeCode,
  registerCodex,
} from "./mcp-register";

// Only run the CLI (or respawn it below) when this file is executed directly, not when
// a test imports it for `ask`/`checkPairedIgCreds`/etc. tsx runs this file as CJS in the
// dev repo and in a bundle (require.main is set); vitest's ESM loader never sets
// require.main here.
const isMain = typeof require !== "undefined" && require.main === module;

// `kai` can be invoked from any cwd (packaging/build-bundle.sh's launcher execs tsx
// without a `cd` first). tsx resolves `@/`-aliased imports (service-darwin.ts's
// services() reaches `@/server/connectors/secrets` -> `@/server/db`, loaded lazily inside
// igEnv()) against a project root it locates once, before this file's own top-level
// code runs at all -- confirmed by direct experiment: even `process.chdir(REPO)` as the
// very first statement of a throwaway entry script, before any import, does not change
// which root a later `import("@/server/db")` resolves against in that same process. A
// plain `process.chdir()` here would compile, look right, and silently do nothing.
// The only fix that actually works is a real OS-level respawn: hand off to a fresh `kai`
// process whose cwd is appRoot from the moment the OS creates it, before tsx's own
// loader ever initializes. Only for the actual CLI invocation (isMain); importing this
// module from a test must never spawn a child process.
if (isMain && process.cwd() !== REPO) {
  const res = spawnSync(nodeBin, [tsxBin, join(REPO, "src", "kai-cli", "kai.ts"), ...process.argv.slice(2)], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (res.error) {
    console.error(`Failed to respawn kai with cwd=${REPO}: ${res.error.message}`);
    process.exit(1);
  }
  // res.status is null when the child died by signal (e.g. Ctrl-C); use the
  // conventional 128+signum in that case instead of collapsing it to a flat 1.
  const signalNum = res.signal ? osConstants.signals[res.signal] : undefined;
  process.exit(signalNum !== undefined ? 128 + signalNum : (res.status ?? 1));
}

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

// ---------------------------------------------------------------- prompting

export type PromptStream = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
export type PromptIO = { input?: PromptStream; output?: NodeJS.WritableStream };

// One interface for the whole run, read through its async iterator. readline's
// question() drops lines when stdin is a pipe (every line arrives at once and
// only the pending question catches one); the iterator queues them instead, so
// the same code path works for a real terminal and for `kai kit init < answers`.
let rl: ReturnType<typeof createInterface> | null = null;
let lines: AsyncIterator<string> | null = null;

function io(streams: PromptIO = {}) {
  if (!rl) {
    rl = createInterface({
      input: streams.input ?? process.stdin,
      output: streams.output ?? process.stdout,
    });
    lines = rl[Symbol.asyncIterator]();
  }
  return rl;
}

export const closeIo = (): void => {
  rl?.close();
  rl = null;
  lines = null;
};

/** Read one line with the terminal's echo off, by putting stdin in raw mode and
 *  reading bytes directly. Replaces a prior hack that poked readline's undocumented
 *  `_writeToOutput` internal to suppress echo — that hook is not part of Node's public
 *  API and stopped reliably suppressing echo, so passwords were landing in scrollback.
 *  Raw mode is the documented way to read a password from a real terminal. */
function readSecretLine(input: PromptStream): Promise<string> {
  return new Promise((resolve) => {
    input.setRawMode?.(true);
    input.resume();
    let value = "";
    // ponytail: byte-wise, ASCII-width handling of backspace/CR/Ctrl-C — fine for
    // passwords and tokens; upgrade to a buffered UTF-8 decoder if that changes.
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 0x03) {
          // Ctrl-C: bail out like the rest of the CLI's early exits.
          input.removeListener("data", onData);
          input.setRawMode?.(false);
          process.exit(1);
        } else if (byte === 0x0d || byte === 0x0a) {
          input.removeListener("data", onData);
          input.setRawMode?.(false);
          resolve(value);
          return;
        } else if (byte === 0x7f || byte === 0x08) {
          value = value.slice(0, -1);
        } else {
          value += String.fromCharCode(byte);
        }
      }
    };
    input.on("data", onData);
  });
}

/** Ask one question. `secret` hides typing on a real terminal. `input`/`output`
 *  default to process.stdin/stdout and exist so tests can inject a fake terminal. */
export async function ask(
  question: string,
  { fallback = "", secret = false, input = process.stdin, output = process.stdout }: { fallback?: string; secret?: boolean } & PromptIO = {},
): Promise<string> {
  output.write(fallback ? `${question} [${fallback}]: ` : `${question}: `);

  if (secret && input.isTTY && typeof input.setRawMode === "function") {
    closeIo(); // hand stdin to the raw-mode reader below instead of readline
    const value = await readSecretLine(input);
    output.write("\n");
    io({ input, output }); // recreate the shared interface for any asks that follow
    return value.trim() || fallback;
  }

  io({ input, output });
  const { value } = await lines!.next();
  return String(value ?? "").trim() || fallback;
}

// ---------------------------------------------------------------- env editing

/** Replace `NAME=...` in place, keeping surrounding comments and ordering. */
function setEnv(text: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

/** Mirrors services/ig/crowsnest_ig/config.py's pairing rule: IG_USERNAME and
 *  IG_PASSWORD must be set together, or both left blank. Returns an error message,
 *  or null when the pair is fine. */
export function checkPairedIgCreds(username: string, password: string): string | null {
  if (Boolean(username) === Boolean(password)) return null;
  const have = username ? "a username but no password" : "a password but no username";
  return (
    `IG_USERNAME and IG_PASSWORD must be set together (or both left blank): you gave ${have}. ` +
    "The Instagram sidecar refuses to boot with only one of them set (services/ig/crowsnest_ig/config.py)."
  );
}

/** Read one `NAME=value` line straight out of .env.local. kai.ts never sources this
 *  file into process.env (see crowsnest_ig/config.py's own loader for why sourcing a
 *  password-bearing file is unsafe); this is just enough to read back what kit init
 *  wrote, for the health checks below. */
function readEnvValue(name: string): string | undefined {
  const envPath = join(REPO, ".env.local");
  if (!existsSync(envPath)) return undefined;
  return readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1];
}

function run(cmd: string, args: string[], cwd = REPO): void {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) die(`\n\`${cmd} ${args.join(" ")}\` failed. Fix the error above, then rerun \`kai kit init\`.`);
}

/** Run a repo tsx script through the right node (bundled node in a bundle, host node in
 *  the dev repo). Avoids shelling out to `npm run`, which would grab a buyer's Homebrew
 *  node and crash on the native-module ABI. */
function runScript(relPath: string): void {
  run(nodeBin, [tsxBin, join(REPO, relPath)]);
}

// ---------------------------------------------------------------- commands

async function cmdLogin(key: string | undefined): Promise<void> {
  if (!key) die("Usage: kai login <license-key>");
  process.stdout.write("Checking your license with Polar...\n");
  try {
    const e = await login(key!);
    console.log(`License active. Saved to ${entitlementPath()}`);
    console.log("Next: kai kit init");
    if (!e.customer_id) console.log("(Polar returned no customer id, which is fine.)");
  } catch (err) {
    if (err instanceof LicenseError) die(err.message);
    die(`Could not reach Polar: ${(err as Error).message}`);
  }
}

async function cmdKitInit(): Promise<void> {
  if (!readEntitlement()) {
    die("No license found. Run `kai login <license-key>` first.");
  }

  const envPath = join(REPO, ".env.local");
  const examplePath = join(REPO, ".env.example");
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    console.log("Created .env.local from .env.example");
  } else {
    console.log(".env.local already exists, editing it in place");
  }
  let env = readFileSync(envPath, "utf8");

  console.log("\nInstagram account. Use a throwaway one: instagrapi drives the private");
  console.log("API and accounts do get challenged or banned. See services/ig/README.md.");
  const igUser = await ask("IG_USERNAME");
  if (igUser) {
    const igPass = await ask("IG_PASSWORD (not echoed)", { secret: true });
    const pairErr = checkPairedIgCreds(igUser, igPass);
    if (pairErr) die(pairErr); // refuse before ever touching .env.local
    env = setEnv(env, "IG_USERNAME", igUser);
    env = setEnv(env, "IG_PASSWORD", igPass);
  }

  // The sidecar shared secret is never typed by hand: any long random string works.
  if (/^IG_SERVICE_TOKEN=(change-me.*)?$/m.test(env)) {
    env = setEnv(env, "IG_SERVICE_TOKEN", crypto.randomUUID().replace(/-/g, ""));
    console.log("Generated IG_SERVICE_TOKEN");
  }

  closeIo();
  writeFileSync(envPath, env, { mode: 0o600 });
  // writeFileSync's mode only applies when it creates the file, and copyFileSync
  // above may have already made it 0644. This file holds the IG password.
  chmodSync(envPath, 0o600);
  console.log(`\nWrote ${envPath}`);

  // In a bundle the prod deps ship inside the tarball, so there is nothing to install.
  // In the dev repo, install deps so a fresh clone works.
  if (!isBundle) {
    console.log("\nInstalling dependencies...");
    run("npm", ["ci"]);
  }
  // Migrations create the tables; bootstrap inserts the built-in filter presets into them.
  // Bootstrap alone on a fresh db dies on "no such table". Run both through node -> tsx
  // directly (never `npm run`, which would use the buyer's node).
  console.log("\nCreating the database...");
  runScript("src/server/db/migrate.ts");
  runScript("src/server/db/bootstrap.ts");

  console.log("\nKit ready. Starting crowsnest...");
  await cmdUp();

  // With the server up, register the MCP endpoint so Claude/Codex can drive crowsnest
  // right away. Non-fatal: init has already succeeded, and cmdMcp prints manual config.
  console.log("\nWiring up MCP for your agent...");
  try {
    await cmdMcp();
  } catch (err) {
    console.error(`MCP registration hit a snag (run \`kai mcp\` to retry): ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------- service commands

const SERVER_URL = "http://localhost:3000";
const MCP_URL = `${SERVER_URL}/api/mcp`;

function requireLicense(): void {
  if (!readEntitlement()) die("No license found. Run `kai login <license-key>` first.");
}

async function cmdStart(): Promise<void> {
  requireLicense();
  await svc.start();
  console.log("crowsnest services started (server on 3000, Instagram helper on 8765).");
}

async function cmdStop(): Promise<void> {
  await svc.stop();
  console.log("crowsnest services stopped.");
}

async function poll(url: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 307 || res.status === 404) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

function tailLog(label: string, n = 10): void {
  const p = join(logDir, `${label}.log`);
  if (!existsSync(p)) return;
  const lines = readFileSync(p, "utf8").trimEnd().split("\n").slice(-n);
  console.log(`\n--- last ${n} lines of ${label} ---`);
  console.log(lines.join("\n"));
}

const IG_SERVICE_URL = "http://127.0.0.1:8765";

/** GET the sidecar's /health, authenticated the same way src/server/ig/client.ts does. */
async function checkSidecarHealth(): Promise<boolean> {
  try {
    const token = readEnvValue("IG_SERVICE_TOKEN");
    const res = await fetch(`${IG_SERVICE_URL}/health`, {
      headers: token ? { "X-IG-Token": token } : {},
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function cmdUp(): Promise<void> {
  requireLicense();
  await svc.start();
  process.stdout.write("Starting crowsnest (waiting for the dashboard)...");
  const ok = await poll(SERVER_URL, 25_000);
  process.stdout.write("\n");
  if (!ok) {
    console.error("The dashboard did not come up within 25s.");
    tailLog("com.crowsnest.server");
    die("Run `kai doctor` to diagnose.");
  }
  console.log(`crowsnest is running: ${SERVER_URL}`);

  if (!(await checkSidecarHealth())) {
    console.error("The Instagram sidecar did not respond to a health check.");
    tailLog("com.crowsnest.ig");
  }

  spawnSync("open", [SERVER_URL], { stdio: "ignore" });
}

/**
 * Register the crowsnest MCP server with the local reasoning agents and print config for
 * every other client. Crowsnest is the data/action brain; Claude/Codex is the reasoning
 * brain, so a buyer's very next move after setup is pointing their agent at the MCP
 * endpoint. `print` (or --print) only prints, never writes; the default `kai mcp` both
 * registers the local agents and prints. Never fatal: a failed client registration still
 * leaves the printed config as the manual fallback.
 */
async function cmdMcp(rest: string[] = []): Promise<void> {
  const printOnly = rest.includes("--print") || rest[0] === "print";

  const probe = await probeMcp(MCP_URL);
  if (probe.reachable) {
    console.log(`MCP endpoint ${MCP_URL} [OK] ${probe.detail}`);
  } else {
    console.log(`MCP endpoint ${MCP_URL} [!!] not reachable (${probe.detail}). Start it with \`kai up\`.`);
  }

  if (!printOnly) {
    console.log("\nRegistering with local agents:");
    for (const r of [registerClaudeCode(MCP_URL), registerCodex(MCP_URL)]) {
      console.log(`  [${r.ok ? "OK" : "--"}] ${r.client.padEnd(12)} ${r.detail}`);
    }
  }

  console.log("\nGeneric MCP client (add to its config):");
  console.log(genericMcpJson(MCP_URL));
  console.log(`\nClaude Code (manual): claude ${claudeCodeAddArgs(MCP_URL).join(" ")}`);
  console.log(`\nCodex (${codexConfigPath()}): append`);
  console.log(`  [mcp_servers.crowsnest]\n  url = "${MCP_URL}"`);
  console.log(`\nClaude Desktop (${claudeDesktopConfigPath()}):`);
  console.log(claudeDesktopJson(MCP_URL));
  console.log('\nRestart your MCP client, then verify with a call like crowsnest_channels.');
}

async function cmdStatusFull(): Promise<void> {
  const e = readEntitlement();
  console.log(`License:  ${e ? `active (activation ${e.activation_id})` : "not logged in"}`);
  for (const s of await svc.services()) {
    const state = svc.running(s.label) ? "running" : svc.installed(s.label) ? "stopped" : "not installed";
    console.log(`${s.label}: ${state}`);
  }
}

/** Health check. Reads local files/processes; the only network call is the sidecar's
 *  own loopback-only /health, and only when the sidecar is running. */
async function cmdDoctor(): Promise<void> {
  const ok = (label: string, good: boolean, detail: string) =>
    console.log(`[${good ? "OK" : "!!"}] ${label.padEnd(22)} ${detail}`);

  const versionFile = join(REPO, "..", "VERSION");
  ok("version", existsSync(versionFile), existsSync(versionFile) ? readFileSync(versionFile, "utf8").split("\n")[0] : "no VERSION file (dev repo?)");
  ok("mode", true, isBundle ? "bundled" : "dev repo");

  let natives = false;
  let nativeErr = "";
  try {
    // Runtime probe that the prebuilt native modules load on this machine; a
    // path-based require is deliberate and cannot be a static import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(join(REPO, "node_modules", "better-sqlite3"));
    natives = true;
  } catch (err) {
    natives = false;
    nativeErr = (err as Error).message;
  }
  ok("native modules", natives, natives ? "better-sqlite3 loads" : `FAIL: ${nativeErr}`);

  const venvOk = existsSync(igVenvPython);
  ok("python sidecar", venvOk, venvOk ? igVenvPython : "venv missing (rerun kai kit init)");
  if (venvOk) {
    const r = spawnSync(igVenvPython, ["-c", "import crowsnest_ig"], { cwd: igDir });
    ok("sidecar import", r.status === 0, r.status === 0 ? "crowsnest_ig imports" : "import failed");
  }

  const envLocal = join(REPO, ".env.local");
  ok("config", existsSync(envLocal), existsSync(envLocal) ? envLocal : "no .env.local (rerun kai kit init)");

  const pairErr = checkPairedIgCreds(readEnvValue("IG_USERNAME") ?? "", readEnvValue("IG_PASSWORD") ?? "");
  ok("config: IG creds paired", !pairErr, pairErr ?? "IG_USERNAME/IG_PASSWORD both set or both blank");

  ok("license", Boolean(readEntitlement()), readEntitlement() ? "entitlement cached" : "run kai login");

  for (const s of await svc.services()) {
    ok(s.label, svc.running(s.label), svc.running(s.label) ? "running" : "stopped");
  }

  const igRunning = svc.running("com.crowsnest.ig");
  const igHealthy = igRunning && (await checkSidecarHealth());
  ok(
    "sidecar health",
    !igRunning || igHealthy,
    !igRunning ? "not running" : igHealthy ? "responds to /health" : "not responding to /health (see kai up, or the ig log)",
  );

  // MCP endpoint: the reason the Kit exists (Claude/Codex reach crowsnest through it).
  // Only a failure when the server is up but the endpoint doesn't answer a tools/list.
  const serverRunning = svc.running("com.crowsnest.server");
  if (serverRunning) {
    const probe = await probeMcp(MCP_URL);
    ok("mcp endpoint", probe.reachable, probe.reachable ? `${MCP_URL} (${probe.detail})` : `${MCP_URL} unreachable: ${probe.detail}`);
  } else {
    ok("mcp endpoint", true, "server stopped (start with kai up), then: kai mcp");
  }

  // uv + wheelhouse presence, bundle only
  if (isBundle) {
    ok("uv", existsSync(uvBin), uvBin);
    ok("wheelhouse", existsSync(wheelhouse), wheelhouse);
  }
}

/** After an update flips to a new version dir: migrate, and restart if it was running. */
async function cmdPostUpdate(): Promise<void> {
  runScript("src/server/db/migrate.ts");
  if (svc.running("com.crowsnest.server")) await svc.start();
}

// KIT-3: this must match packaging/install.sh.template's own KAI_INSTALL_URL default —
// that's the gate that both first installs and updates go through.
export const DEFAULT_INSTALL_URL = "https://crowsnest-gate.kaiships.workers.dev/install.sh";

/** Re-run the installer, which downloads the latest version and flips `current` to it.
 *  The installer reuses the cached license key, so the buyer never retypes it. */
function cmdUpdate(): void {
  requireLicense();
  if (!isBundle) die("kai update is for installed builds, not the dev repo.");
  const installUrl = process.env.KAI_INSTALL_URL ?? DEFAULT_INSTALL_URL;
  console.log("Updating crowsnest...");
  // curl the installer and run it; it reads the cached key from ~/.kai/state/entitlement.json.
  const res = spawnSync("bash", ["-c", `curl -fsSL ${installUrl} | bash`], { stdio: "inherit" });
  if (res.status !== 0) die("Update failed. Your current version is untouched.");
}

function migrationFiles(drizzleDir: string): Set<string> {
  if (!existsSync(drizzleDir)) return new Set();
  return new Set(readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")));
}

/** Flip `~/.kai/app/current` back to the other installed version and re-run the
 *  post-update routine (migrate, restart if running). Refuses when the two versions'
 *  drizzle/ migrations differ: the database would be left on a schema the rolled-back
 *  code doesn't expect. Only ever keeps one previous version around (see
 *  install.sh.template step 9), so "the other version" is unambiguous. */
export function cmdRollback(): void {
  if (!isBundle) die("kai rollback is for installed builds, not the dev repo.");
  const appsDir = join(homedir(), ".kai", "app");
  const currentLink = join(appsDir, "current");
  if (!existsSync(currentLink)) die(`No current install found at ${currentLink}.`);

  const currentName = basename(readlinkSync(currentLink));
  const versions = readdirSync(appsDir).filter((d) => d.startsWith("v") && statSync(join(appsDir, d)).isDirectory());
  const other = versions.find((v) => v !== currentName);
  if (!other) die(`No other version installed to roll back to (only ${currentName} is present).`);

  const currentMigrations = migrationFiles(join(appsDir, currentName, "app", "drizzle"));
  const otherMigrations = migrationFiles(join(appsDir, other!, "app", "drizzle"));
  const onlyCurrent = [...currentMigrations].filter((m) => !otherMigrations.has(m)).sort();
  const onlyOther = [...otherMigrations].filter((m) => !currentMigrations.has(m)).sort();
  if (onlyCurrent.length || onlyOther.length) {
    die(
      [
        `Refusing to roll back ${currentName} -> ${other}: their drizzle/ migrations differ.`,
        onlyCurrent.length ? `Only in ${currentName}: ${onlyCurrent.join(", ")}` : null,
        onlyOther.length ? `Only in ${other}: ${onlyOther.join(", ")}` : null,
        "Rolling back would leave the database on a schema the older code doesn't expect. Fix the migrations, then retry.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const target = join(appsDir, other!);
  const tmp = join(appsDir, "current.tmp");
  try {
    unlinkSync(tmp);
  } catch {
    // no stale tmp link left over
  }
  symlinkSync(target, tmp);
  renameSync(tmp, currentLink);
  console.log(`Rolled back: ${currentName} -> ${other}`);

  // Run the post-update routine (migrate + restart) in a FRESH process, not in-process:
  // this process's appRoot (src/kai-cli/runtime.ts) was resolved from __dirname when it
  // started, before the symlink flip above, so it is still pinned to the OLD version.
  // Calling cmdPostUpdate() here would migrate and restart the server against the OLD
  // code. A freshly spawned `kai _postupdate`, launched from the NEW version's own bin,
  // re-resolves appRoot from scratch and lands on the version we just rolled back to.
  // Same pattern install.sh.template uses after flipping `current` on update.
  const newBin = join(target, "bin", "kai");
  spawn(newBin, ["_postupdate"], { detached: true, stdio: "ignore" }).unref();
}

// ---------------------------------------------------------------- entry

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "login":
      await cmdLogin(rest[0]);
      break;
    case "status":
      await cmdStatusFull();
      break;
    case "kit":
      if (rest[0] !== "init") die("Usage: kai kit init");
      await cmdKitInit();
      break;
    case "up":
      await cmdUp();
      break;
    case "mcp":
      await cmdMcp(rest);
      break;
    case "start":
      await cmdStart();
      break;
    case "stop":
      await cmdStop();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "update":
      await cmdUpdate();
      break;
    case "rollback":
      cmdRollback();
      break;
    case "_postupdate":
      await cmdPostUpdate();
      break;
    default:
      console.log("crowsnest Kit\n");
      console.log("  kai login <license-key>   validate your key, claim an activation");
      console.log("  kai kit init              set up config, build the db, start crowsnest");
      console.log("  kai up                    start crowsnest and open the dashboard");
      console.log("  kai mcp                   register the MCP server with Claude/Codex, print config");
      console.log("  kai start | stop          run or halt the background services");
      console.log("  kai status                license + service state");
      console.log("  kai doctor                health check");
      console.log("  kai update                update to the latest version");
      console.log("  kai rollback              revert to the previously installed version");
      process.exit(cmd ? 1 : 0);
  }
}

if (isMain) {
  main().catch((err: Error) => die(err.message));
}
