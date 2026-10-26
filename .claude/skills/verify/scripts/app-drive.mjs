import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const APP = ROOT;
const STATE = path.join(ROOT, "data/verify/app/state.json");
const LOG = path.join(ROOT, "data/verify/app/host.log");
const appRequire = createRequire(path.join(APP, "package.json"));
const { chromium } = appRequire("@playwright/test");
const { PNG } = appRequire("pngjs");
const BASELINES = path.join(import.meta.dirname, "../baselines");

// Share of pixels whose largest channel differs by more than 32 of 255; changed pixels go red in the diff image.
function diffImages(actualPath, baselinePath, diffPath) {
  const a = PNG.sync.read(readFileSync(actualPath));
  const b = PNG.sync.read(readFileSync(baselinePath));
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, note: `size ${a.width}x${a.height} vs baseline ${b.width}x${b.height}` };
  const diff = new PNG({ width: a.width, height: a.height });
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    const hit = delta > 32;
    if (hit) changed++;
    const grey = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 12 + 170;
    diff.data.set(hit ? [255, 0, 0, 255] : [grey, grey, grey, 255], i);
  }
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { ratio: changed / (a.width * a.height), note: "" };
}

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
    // Compares the shot with the approved baselines/<file>.png; UPDATE_BASELINE=1 writes this run's shot as the baseline.
    // Pass `target` (a locator) to shoot one element, so tabs and clocks outside it never count as a change.
    async snapAndCompare(file, { target = page, threshold = 0.005 } = {}) {
      const out = path.join(dir, `${file}.png`);
      await target.screenshot({ path: out });
      log(`snap: ${path.relative(ROOT, out)}`);
      const baseline = path.join(BASELINES, `${file}.png`);
      if (process.env.UPDATE_BASELINE === "1") {
        mkdirSync(BASELINES, { recursive: true });
        copyFileSync(out, baseline);
        return log(`diff: ${file} baseline approved`);
      }
      if (!existsSync(baseline)) {
        log(`FAIL: diff: ${file} has no baseline; check the shot, then rerun with UPDATE_BASELINE=1 to write it`);
        throw new Error(`no baseline for ${file}`);
      }
      const { ratio, note } = diffImages(out, baseline, path.join(dir, `${file}.diff.png`));
      const line = `${file} ${(ratio * 100).toFixed(2)}% changed (threshold ${(threshold * 100).toFixed(2)}%)${note ? `, ${note}` : ""}`;
      if (ratio > threshold) {
        log(`FAIL: diff: ${line}`);
        throw new Error(`screenshot ${line}`);
      }
      log(`ok: diff: ${line}`);
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

async function secondsToFirstContentfulPaint(label, executable, args, env) {
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
    secondsToFirstContentfulPaint(
      "Orca.app",
      "/Applications/Orca.app/Contents/MacOS/Orca",
      (tmp) => [`--user-data-dir=${path.join(tmp, "user-data")}`, "--password-store=basic", "--use-mock-keychain"],
      (_tmp, home) => ({ ...inherited, HOME: home }),
    );
  const lead = () =>
    secondsToFirstContentfulPaint(
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
