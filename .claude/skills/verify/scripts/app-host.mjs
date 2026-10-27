import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, watchFile, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { copyDbOnce } from "../../../../scripts/copy-db.ts";
import { getE2ECompletedOnboardingProfile } from "../../../../tests/e2e/helpers/e2e-completed-onboarding-profile.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const APP = ROOT;
const STATE_DIR = path.join(ROOT, "data/verify/app");
const appRequire = createRequire(path.join(APP, "package.json"));
const { _electron: electron, chromium } = appRequire("@playwright/test");

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

function seedRepo(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "verify@lead-studio.local");
  git("config", "user.name", "Lead Studio verify");
  writeFileSync(path.join(dir, "README.md"), "# Lead Studio verify repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

// The CLI socket lives in user data, and macOS caps a socket path at 104 bytes, so keep it shallow.
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ls-")));
const userDataDir = path.join(tmp, "u");
const home = path.join(tmp, "h");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(home, { recursive: true, mode: 0o700 });
writeFileSync(path.join(userDataDir, "orca-data.json"), JSON.stringify(getE2ECompletedOnboardingProfile(), null, 2));
// APP_NO_REPO=1 leaves the profile with no project, the state a first launch is in.
const noRepo = process.env.APP_NO_REPO === "1";
const repoPath = noRepo ? null : seedRepo(path.join(tmp, "repo"));
const dbPath = path.join(userDataDir, "crowsnest.db");
if (process.env.APP_DB) copyDbOnce(path.resolve(ROOT, process.env.APP_DB), dbPath);

const cdpPort = await freePort();
const { ELECTRON_RUN_AS_NODE: _drop, ...inherited } = process.env;
const headless = process.env.APP_HEADLESS === "1";
const dev = process.env.APP_DEV === "1";
const electronArgs = [`--remote-debugging-port=${cdpPort}`, "--password-store=basic", "--use-mock-keychain"];
const env = {
  ...inherited,
  HOME: home,
  ORCA_E2E_HOME_DIR: home,
  ORCA_E2E_USER_DATA_DIR: userDataDir,
  CROWSNEST_DB_PATH: dbPath,
  NODE_ENV: "development",
  ...(headless ? { ORCA_E2E_HEADLESS: "1" } : { ORCA_E2E_HEADFUL: "1" }),
};

// Build mode: Playwright launches the built out/. Dev mode: electron-vite dev serves the renderer
// with HMR and rebuilds main on change (restarting Electron), and the host attaches over CDP.
async function launchBuilt() {
  const app = await electron.launch({
    cwd: APP,
    args: [...electronArgs, APP, "-ApplePersistenceIgnoreState", "YES"],
    env,
    ...(process.env.APP_RECORD_VIDEO ? { recordVideo: { dir: process.env.APP_RECORD_VIDEO } } : {}),
  });
  app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
  app.process().stderr?.on("data", (d) => process.stdout.write(`[main] ${d}`));
  return {
    page: await app.firstWindow({ timeout: 120_000 }),
    onExit: (fn) => app.on("close", fn),
    close: () => app.close().catch(() => app.process().kill("SIGKILL")),
  };
}

async function launchDev() {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "app-dev.mjs"), String(await freePort())], {
    cwd: APP,
    env: {
      ...env,
      VITE_EXPOSE_STORE: "true",
      ELECTRON_CLI_ARGS: JSON.stringify([...electronArgs, "-ApplePersistenceIgnoreState", "YES"]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[dev] ${d}`));
  child.stderr.on("data", (d) => process.stdout.write(`[dev] ${d}`));
  let exited = false;
  child.on("exit", () => (exited = true));
  let browser;
  for (let i = 0; !browser; i++) {
    if (exited) throw new Error("electron-vite dev exited before the app came up");
    if (i === 300) throw new Error("no CDP endpoint after 300s of electron-vite dev");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 1000));
  }
  let page;
  for (let i = 0; !page; i++) {
    if (i === 600) throw new Error("no Lead Studio main window over CDP");
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => /^http:\/\/localhost:\d+\/$/.test(p.url()));
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  return {
    page,
    onExit: (fn) => child.on("exit", fn),
    close: () =>
      new Promise((resolve) => {
        if (exited) return resolve();
        child.on("exit", resolve);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      }),
  };
}

const app = dev ? await launchDev() : await launchBuilt();
const { page } = app;
page.on("console", (m) => console.log(`[renderer:${m.type()}] ${m.text()}`));
await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 60_000 });
const repoId = noRepo
  ? null
  : await page.evaluate(async (p) => {
      const result = await window.api.repos.add({ path: p });
      if ("error" in result) throw new Error(result.error);
      return result.repo.id;
    }, repoPath);
await page.waitForFunction(() => window.__store.getState().workspaceSessionReady === true, null, {
  timeout: 60_000,
});
const openRepoTerminal = (id) =>
  page.evaluate(async (id) => {
    const s = window.__store.getState();
    await s.fetchRepos({ runtimeEnvironmentId: null, throwOnError: false });
    await s.fetchWorktrees(id);
    const main = window.__store.getState().worktreesByRepo[id]?.find((w) => w.isMainWorktree);
    if (!main) return false;
    window.__store.getState().setActiveWorktree(main.id);
    const fresh = window.__store.getState();
    if ((fresh.tabsByWorktree[main.id] ?? []).length === 0) fresh.createTab(main.id);
    return true;
  }, id);
for (let i = 0; !noRepo && !(await openRepoTerminal(repoId)); i++) {
  if (i === 60) throw new Error("seeded repo never showed its main worktree");
  await new Promise((r) => setTimeout(r, 1000));
}

const mcpPortFile = path.join(userDataDir, "mcp.port");
for (let i = 0; !existsSync(mcpPortFile); i++) {
  if (i === 60) throw new Error("crowsnest MCP never wrote mcp.port");
  await new Promise((r) => setTimeout(r, 500));
}
mkdirSync(STATE_DIR, { recursive: true });
function copyMcpAccess() {
  if (!existsSync(mcpPortFile)) return;
  writeFileSync(path.join(STATE_DIR, "mcp.port"), readFileSync(mcpPortFile, "utf8"));
  rmSync(path.join(STATE_DIR, "mcp.token"), { force: true });
  writeFileSync(path.join(STATE_DIR, "mcp.token"), readFileSync(path.join(userDataDir, "mcp.token"), "utf8"), { mode: 0o600 });
}
copyMcpAccess();
// A main rebuild restarts Electron, and the restarted MCP listens on a new port.
if (dev) watchFile(mcpPortFile, { interval: 1000 }, copyMcpAccess);
writeFileSync(
  path.join(STATE_DIR, "state.json"),
  JSON.stringify({ cdpPort, userDataDir, cookRoot: process.env.LEAD_STUDIO_COOK_ROOT ?? null }, null, 2),
);
console.log(`app: ready (cdp ${cdpPort}, user data ${userDataDir}${dev ? ", dev mode" : ""})`);

const stopDetachedTerminalDaemon = (profile) => spawnSync("pkill", ["-f", "--", `--socket ${profile}/daemon`]);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  stopDetachedTerminalDaemon(userDataDir);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(STATE_DIR, "state.json"), { force: true });
  rmSync(path.join(STATE_DIR, "mcp.port"), { force: true });
  rmSync(path.join(STATE_DIR, "mcp.token"), { force: true });
  console.log("app: closed");
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
app.onExit(() => {
  if (!closing) {
    console.log("app: exited on its own");
    rmSync(path.join(STATE_DIR, "state.json"), { force: true });
    rmSync(path.join(STATE_DIR, "mcp.token"), { force: true });
    process.exit(1);
  }
});
