#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

// ---------------------------------------------------------------- prompting

// One interface for the whole run, read through its async iterator. readline's
// question() drops lines when stdin is a pipe (every line arrives at once and
// only the pending question catches one); the iterator queues them instead, so
// the same code path works for a real terminal and for `kai kit init < answers`.
let rl: ReturnType<typeof createInterface> | null = null;
let lines: AsyncIterator<string> | null = null;

function io() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    lines = rl[Symbol.asyncIterator]();
  }
  return rl;
}

const closeIo = () => {
  rl?.close();
  rl = null;
  lines = null;
};

/** Ask one question. `secret` hides typing on a real terminal. */
async function ask(
  question: string,
  { fallback = "", secret = false }: { fallback?: string; secret?: boolean } = {},
): Promise<string> {
  const term = io() as unknown as { _writeToOutput?: (s: string) => void };
  process.stdout.write(fallback ? `${question} [${fallback}]: ` : `${question}: `);

  // Suppress the echo so a password never lands in the terminal scrollback.
  const echo = term._writeToOutput;
  const hide = secret && process.stdin.isTTY && typeof echo === "function";
  if (hide) term._writeToOutput = () => {};

  const { value } = await lines!.next();

  if (hide) {
    term._writeToOutput = echo;
    process.stdout.write("\n");
  }
  return String(value ?? "").trim() || fallback;
}

// ---------------------------------------------------------------- env editing

/** Replace `NAME=...` in place, keeping surrounding comments and ordering. */
function setEnv(text: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
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

function cmdStatus(): void {
  const e = readEntitlement();
  if (!e) {
    console.log("Not logged in. Run: kai login <license-key>");
    process.exit(1);
  }
  console.log(`Licensed. Activation ${e.activation_id}, last checked ${e.validated_at}.`);
  console.log(`Cached at ${entitlementPath()}`);
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
    env = setEnv(env, "IG_USERNAME", igUser);
    if (igPass) env = setEnv(env, "IG_PASSWORD", igPass);
  }

  // The sidecar shared secret is never typed by hand: any long random string works.
  if (/^IG_SERVICE_TOKEN=(change-me.*)?$/m.test(env)) {
    env = setEnv(env, "IG_SERVICE_TOKEN", crypto.randomUUID().replace(/-/g, ""));
    console.log("Generated IG_SERVICE_TOKEN");
  }

  console.log("\nANTHROPIC_API_KEY is optional. Skip it and the Create-Prompt export still");
  console.log("works keyless. AI analysis and the Vault pipeline need the key.");
  const apiKey = await ask("ANTHROPIC_API_KEY (blank to skip, not echoed)", { secret: true });
  if (apiKey) env = setEnv(env, "ANTHROPIC_API_KEY", apiKey);

  const defaultVault = join(homedir(), ".crowsnest", "vault");
  const vault = await ask("\nVAULT_PATH", { fallback: defaultVault });
  mkdirSync(vault, { recursive: true });
  env = setEnv(env, "VAULT_PATH", vault);

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
}

// ---------------------------------------------------------------- service commands

const SERVER_URL = "http://localhost:3000";

function requireLicense(): void {
  if (!readEntitlement()) die("No license found. Run `kai login <license-key>` first.");
}

function cmdStart(): void {
  requireLicense();
  svc.start();
  console.log("crowsnest services started (server on 3000, Instagram helper on 8765).");
}

function cmdStop(): void {
  svc.stop();
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

async function cmdUp(): Promise<void> {
  requireLicense();
  svc.start();
  process.stdout.write("Starting crowsnest (waiting for the dashboard)...");
  const ok = await poll(SERVER_URL, 25_000);
  process.stdout.write("\n");
  if (!ok) {
    console.error("The dashboard did not come up within 25s.");
    tailLog("com.crowsnest.server");
    die("Run `kai doctor` to diagnose.");
  }
  console.log(`crowsnest is running: ${SERVER_URL}`);
  spawnSync("open", [SERVER_URL], { stdio: "ignore" });
}

function cmdStatusFull(): void {
  const e = readEntitlement();
  console.log(`License:  ${e ? `active (activation ${e.activation_id})` : "not logged in"}`);
  for (const s of svc.services()) {
    const state = svc.running(s.label) ? "running" : svc.installed(s.label) ? "stopped" : "not installed";
    console.log(`${s.label}: ${state}`);
  }
}

/** Read-only health check. Never touches the network. */
async function cmdDoctor(): Promise<void> {
  const ok = (label: string, good: boolean, detail: string) =>
    console.log(`[${good ? "OK" : "!!"}] ${label.padEnd(22)} ${detail}`);

  const versionFile = join(REPO, "..", "VERSION");
  ok("version", existsSync(versionFile), existsSync(versionFile) ? readFileSync(versionFile, "utf8").split("\n")[0] : "no VERSION file (dev repo?)");
  ok("mode", true, isBundle ? "bundled" : "dev repo");

  let natives = false;
  try {
    require(join(REPO, "node_modules", "better-sqlite3"));
    require(join(REPO, "node_modules", "node-pty"));
    natives = true;
  } catch (err) {
    natives = false;
    var nativeErr = (err as Error).message;
  }
  ok("native modules", natives, natives ? "better-sqlite3 + node-pty load" : `FAIL: ${nativeErr!}`);

  const venvOk = existsSync(igVenvPython);
  ok("python sidecar", venvOk, venvOk ? igVenvPython : "venv missing (rerun kai kit init)");
  if (venvOk) {
    const r = spawnSync(igVenvPython, ["-c", "import crowsnest_ig"], { cwd: igDir });
    ok("sidecar import", r.status === 0, r.status === 0 ? "crowsnest_ig imports" : "import failed");
  }

  const envLocal = join(REPO, ".env.local");
  ok("config", existsSync(envLocal), existsSync(envLocal) ? envLocal : "no .env.local (rerun kai kit init)");
  ok("license", Boolean(readEntitlement()), readEntitlement() ? "entitlement cached" : "run kai login");

  for (const s of svc.services()) {
    ok(s.label, svc.running(s.label), svc.running(s.label) ? "running" : "stopped");
  }
  // uv + wheelhouse presence, bundle only
  if (isBundle) {
    ok("uv", existsSync(uvBin), uvBin);
    ok("wheelhouse", existsSync(wheelhouse), wheelhouse);
  }
}

/** After an update flips to a new version dir: migrate, and restart if it was running. */
function cmdPostUpdate(): void {
  runScript("src/server/db/migrate.ts");
  if (svc.running("com.crowsnest.server")) svc.start();
}

/** Re-run the installer, which downloads the latest version and flips `current` to it.
 *  The installer reuses the cached license key, so the buyer never retypes it. */
function cmdUpdate(): void {
  requireLicense();
  if (!isBundle) die("kai update is for installed builds, not the dev repo.");
  const installUrl = process.env.KAI_INSTALL_URL ?? "https://get.crowsnest.sh/install.sh";
  console.log("Updating crowsnest...");
  // curl the installer and run it; it reads the cached key from ~/.kai/state/entitlement.json.
  const res = spawnSync("bash", ["-c", `curl -fsSL ${installUrl} | bash`], { stdio: "inherit" });
  if (res.status !== 0) die("Update failed. Your current version is untouched.");
}

// ---------------------------------------------------------------- entry

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "login":
      await cmdLogin(rest[0]);
      break;
    case "status":
      cmdStatusFull();
      break;
    case "kit":
      if (rest[0] !== "init") die("Usage: kai kit init");
      await cmdKitInit();
      break;
    case "up":
      await cmdUp();
      break;
    case "start":
      cmdStart();
      break;
    case "stop":
      cmdStop();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "update":
      await cmdUpdate();
      break;
    case "_postupdate":
      cmdPostUpdate();
      break;
    default:
      console.log("crowsnest Kit\n");
      console.log("  kai login <license-key>   validate your key, claim an activation");
      console.log("  kai kit init              set up config, build the db, start crowsnest");
      console.log("  kai up                    start crowsnest and open the dashboard");
      console.log("  kai start | stop          run or halt the background services");
      console.log("  kai status                license + service state");
      console.log("  kai doctor                health check");
      console.log("  kai update                update to the latest version");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err: Error) => die(err.message));
