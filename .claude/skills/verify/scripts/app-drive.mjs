// Drives the Lead Studio app that app-host.mjs launched, over CDP. Run through app-drive.sh.
//   app-drive.mjs <journey> [run-id]   run app-journeys/<journey>.mjs, write transcript + screenshots
//   app-drive.mjs --console            print the host log (main process and renderer console)
//   app-drive.mjs --timing [rounds]    interleaved cold starts of Orca.app and Lead Studio
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const APP = path.join(ROOT, "studio");
const STATE = path.join(ROOT, "data/verify/app/state.json");
const LOG = path.join(ROOT, "data/verify/app/host.log");
const { chromium } = createRequire(path.join(APP, "package.json"))("@playwright/test");

const MAIN_WINDOW = (url) => /\/renderer\/index\.html$|^http:\/\/localhost:\d+\/$/.test(url);

async function mainPage(browser) {
  for (let i = 0; i < 100; i++) {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => MAIN_WINDOW(p.url()));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no Lead Studio main window over CDP");
}

async function runJourney(name, runId) {
  if (!existsSync(STATE)) throw new Error("no app running: start it with app-up.sh");
  const { cdpPort } = JSON.parse(readFileSync(STATE, "utf8"));
  const dir = path.join(ROOT, "data/verify/evidence", runId);
  mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, `${name}.transcript.txt`);
  writeFileSync(transcript, "");
  const log = (line) => {
    console.log(line);
    appendFileSync(transcript, `${line}\n`);
  };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await mainPage(browser);
  const ctx = {
    page,
    async step(label, fn) {
      try {
        await fn();
        log(`ok: ${label}`);
      } catch (error) {
        log(`FAIL: ${label}: ${String(error?.message ?? error).split("\n")[0]}`);
        await ctx.snap(`${name}-fail`).catch(() => {});
        throw error;
      }
    },
    async snap(file) {
      const out = path.join(dir, `${file}.png`);
      await page.screenshot({ path: out });
      log(`snap: ${path.relative(ROOT, out)}`);
    },
  };
  log(`journey: ${name} run: ${runId}`);
  const journey = await import(pathToFileURL(path.join(import.meta.dirname, "app-journeys", `${name}.mjs`)).href);
  try {
    await journey.default(ctx);
    log(`journey: ${name} passed`);
  } finally {
    await browser.close().catch(() => {});
  }
}

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// Seconds from spawn to the main window's first contentful paint, read from the page's own
// performance timeline so CDP polling latency does not count.
async function coldStart(label, executable, args, env) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lead-studio-timing-"));
  const home = path.join(tmp, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const port = await freePort();
  const t0 = Date.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`, ...args(tmp)], {
    env: env(tmp, home),
    stdio: "ignore",
  });
  try {
    let browser;
    for (let i = 0; !browser && i < 600; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 100));
    }
    if (!browser) throw new Error(`${label}: no CDP endpoint after 60s`);
    const page = await mainPage(browser);
    const fcp = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const read = () => performance.getEntriesByName("first-contentful-paint")[0];
          if (read()) return resolve(performance.timeOrigin + read().startTime);
          new PerformanceObserver(() => read() && resolve(performance.timeOrigin + read().startTime)).observe({
            type: "paint",
            buffered: true,
          });
        }),
    );
    await browser.close().catch(() => {});
    return (fcp - t0) / 1000;
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
    spawnSync("pkill", ["-f", "--", tmp]);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function timing(rounds) {
  const { ELECTRON_RUN_AS_NODE: _drop, ...inherited } = process.env;
  const electronBin = createRequire(path.join(APP, "package.json"))("electron");
  const orca = () =>
    coldStart(
      "Orca.app",
      "/Applications/Orca.app/Contents/MacOS/Orca",
      (tmp) => [`--user-data-dir=${path.join(tmp, "user-data")}`, "--password-store=basic", "--use-mock-keychain"],
      (_tmp, home) => ({ ...inherited, HOME: home }),
    );
  const lead = () =>
    coldStart(
      "Lead Studio",
      electronBin,
      () => ["--password-store=basic", "--use-mock-keychain", APP],
      (tmp, home) => ({
        ...inherited,
        HOME: home,
        ORCA_E2E_HOME_DIR: home,
        ORCA_E2E_USER_DATA_DIR: path.join(tmp, "user-data"),
        NODE_ENV: "development",
        ORCA_E2E_HEADFUL: "1",
      }),
    );
  const rows = [];
  for (let i = 1; i <= rounds; i++) {
    const o = await orca();
    console.log(`timing: round ${i} Orca.app ${o.toFixed(2)}s`);
    const l = await lead();
    console.log(`timing: round ${i} Lead Studio ${l.toFixed(2)}s`);
    rows.push([o, l]);
  }
  const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
  const o = median(rows.map((r) => r[0]));
  const l = median(rows.map((r) => r[1]));
  const ratio = l / o;
  console.log(`timing: median Orca.app ${o.toFixed(2)}s, Lead Studio ${l.toFixed(2)}s, ratio ${ratio.toFixed(2)}x`);
  console.log(ratio > 1.5 ? "timing: FAIL over 1.5x Orca.app" : "timing: ok within 1.5x Orca.app");
  return ratio <= 1.5;
}

const [arg, extra] = process.argv.slice(2);
try {
  if (arg === "--console") {
    console.log(existsSync(LOG) ? readFileSync(LOG, "utf8") : "no host log");
  } else if (arg === "--timing") {
    process.exitCode = (await timing(Number(extra ?? 3))) ? 0 : 1;
  } else if (arg) {
    await runJourney(arg, extra ?? `${arg}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } else {
    console.log("usage: app-drive.sh <journey> [run-id] | --console | --timing [rounds]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`app-drive: ${String(error?.message ?? error).split("\n")[0]}`);
  process.exitCode = 1;
}
