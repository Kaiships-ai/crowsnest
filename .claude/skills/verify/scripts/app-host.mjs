// Launches Lead Studio with Playwright _electron.launch, the way studio/tests/e2e/helpers/orca-app.ts
// does, in a disposable user data dir and HOME. Seeds a git repo with a terminal tab, writes
// data/verify/app/state.json with the CDP port for app-drive.mjs, prints "app: ready", and
// keeps the app open until SIGTERM. Run through app-up.sh.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getE2ECompletedOnboardingProfile } from "../../../../studio/tests/e2e/helpers/e2e-completed-onboarding-profile.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const APP = path.join(ROOT, "studio");
const STATE_DIR = path.join(ROOT, "data/verify/app");
const { _electron: electron } = createRequire(path.join(APP, "package.json"))("@playwright/test");

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
const repoPath = seedRepo(path.join(tmp, "repo"));

const cdpPort = await freePort();
const { ELECTRON_RUN_AS_NODE: _drop, ...inherited } = process.env;
const headless = process.env.APP_HEADLESS === "1";
const app = await electron.launch({
  cwd: APP,
  args: [
    `--remote-debugging-port=${cdpPort}`,
    "--password-store=basic",
    "--use-mock-keychain",
    APP,
    "-ApplePersistenceIgnoreState",
    "YES",
  ],
  env: {
    ...inherited,
    HOME: home,
    ORCA_E2E_HOME_DIR: home,
    ORCA_E2E_USER_DATA_DIR: userDataDir,
    NODE_ENV: "development",
    ...(headless ? { ORCA_E2E_HEADLESS: "1" } : { ORCA_E2E_HEADFUL: "1" }),
  },
  ...(process.env.APP_RECORD_VIDEO ? { recordVideo: { dir: process.env.APP_RECORD_VIDEO } } : {}),
});
app.process().stdout?.on("data", (d) => process.stdout.write(`[main] ${d}`));
app.process().stderr?.on("data", (d) => process.stdout.write(`[main] ${d}`));

const page = await app.firstWindow({ timeout: 120_000 });
page.on("console", (m) => console.log(`[renderer:${m.type()}] ${m.text()}`));
await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 60_000 });
const repoId = await page.evaluate(async (p) => {
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
for (let i = 0; !(await openRepoTerminal(repoId)); i++) {
  if (i === 60) throw new Error("seeded repo never showed its main worktree");
  await new Promise((r) => setTimeout(r, 1000));
}

mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(
  path.join(STATE_DIR, "state.json"),
  JSON.stringify({ cdpPort, userDataDir }, null, 2),
);
console.log(`app: ready (cdp ${cdpPort}, user data ${userDataDir})`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close().catch(() => app.process().kill("SIGKILL"));
  // The terminal daemon is detached by design so terminals outlive the app; stop this profile's.
  spawnSync("pkill", ["-f", "--", `--socket ${userDataDir}/daemon`]);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(STATE_DIR, "state.json"), { force: true });
  console.log("app: closed");
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
app.on("close", () => {
  if (!closing) {
    console.log("app: exited on its own");
    rmSync(path.join(STATE_DIR, "state.json"), { force: true });
    process.exit(1);
  }
});
