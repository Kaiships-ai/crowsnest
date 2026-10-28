import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). The session id form tests only when Test connection is
// pressed, Save stays off until a test passes, and only Save stores the id and hands it to the sidecar.
export const dod = [];

const LOG = path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.log");
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const SESSION = `sidecar-session-01-${Date.now()}`;
const EXPIRED = `${SESSION}-expired`;
const CANCELLED = `${SESSION}-cancelled`;
const LIMITED = `${SESSION}-limited`;
const SAMPLE = "@fake_sidecar · 2,500 followers · 30 posts";
const STATES = path.resolve(import.meta.dirname, "../../../../../data/verify/evidence/sidecar-states");
const port = readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.port"), "utf8").trim();
const fakeMode = (query = "") => fetch(`http://127.0.0.1:${port}/__mode${query}`, { method: "POST" });

async function setTheme(page, dark) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, dark);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

const logged = (route, id) => readFileSync(LOG, "utf8").split("\n").some((l) => l.includes(`POST ${route}`) && l.includes(id));
/** The stored IG_SESSIONID row, sealed or plain, with its write time. */
const savedSession = () =>
  sql("select coalesce((select sealed || updated_at from sealed_secrets where name = 'IG_SESSIONID'), '') || coalesce((select value || updated_at from secrets where name = 'IG_SESSIONID'), '')");

export default async function sidecarSession01({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  const form = card.getByTestId("sidecar-session-form");
  const input = card.getByTestId("sidecar-session-input");
  const save = card.getByTestId("sidecar-form-save");
  const check = card.getByTestId("sidecar-form-check");

  const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  /** The card alone in both themes, named after the prototype frame it matches. */
  const shoot = async (state) => {
    mkdirSync(STATES, { recursive: true });
    for (const dark of [true, false]) {
      await setTheme(page, dark);
      await card.screenshot({ path: path.join(STATES, `${state}-${dark ? "dark" : "light"}.png`) });
    }
    await setTheme(page, wasDark);
  };

  const openForm = async () => {
    if (!(await card.getByTestId("sidecar-enter").count())) {
      await card.getByTestId("sidecar-test").click();
      await card.getByTestId("sidecar-enter").waitFor({ timeout: 15_000 });
    }
    await card.getByTestId("sidecar-enter").click();
    await form.waitFor({ timeout: 5_000 });
  };

  try {
    await step("Settings > Sources: the sidecar card opens the session id form", async () => {
      await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
      await card.waitFor({ timeout: 10_000 });
      await openForm();
    });

    await step("pasting an expired id tests nothing and Save stays off; Test connection shows the expired sentence (C7)", async () => {
      await input.fill(EXPIRED);
      await page.waitForTimeout(1_000);
      if (logged("/sample-session", EXPIRED) || logged("/login-by-session", EXPIRED)) throw new Error("pasting tested the session");
      if (!(await save.isDisabled())) throw new Error("Save is on before a test");
      await shoot("dialog_pasted");
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="err"]').waitFor({ timeout: 15_000 });
      const text = await check.innerText();
      console.log(`form check: ${text}`);
      if (text !== "The session id expired. Sign in to instagram.com and copy a new one.") throw new Error(text);
      if (!(await save.isDisabled())) throw new Error("Save is on after a failed test");
      await shoot("dialog_expired");
    });
    await snap("sidecar-session-01-expired");

    await step("Cancel after a passing test discards the id: no POST /login-by-session, the saved IG_SESSIONID unchanged", async () => {
      const before = savedSession();
      await input.fill(CANCELLED);
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="ok"]').waitFor({ timeout: 15_000 });
      await card.getByTestId("sidecar-form-cancel").click();
      await form.waitFor({ state: "detached", timeout: 10_000 });
      if (!logged("/sample-session", CANCELLED)) throw new Error("Test connection never reached POST /sample-session");
      if (logged("/login-by-session", CANCELLED)) throw new Error("the sidecar adopted a cancelled id");
      if (savedSession() !== before) throw new Error("Cancel changed the saved IG_SESSIONID");
      await openForm();
    });

    await step("a good id: Test connection shows Testing, then the sample, and Save turns on (C5, C6)", async () => {
      await input.fill(SESSION);
      if (!(await save.isDisabled())) throw new Error("Save is on before a test");
      await fakeMode("?delayMs=2500");
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="testing"]').waitFor({ timeout: 5_000 });
      await shoot("dialog_testing");
      await page.locator('[data-testid="sidecar-form-check"][data-check="ok"]').waitFor({ timeout: 15_000 });
      await fakeMode();
      const text = await check.innerText();
      console.log(`form check: ${text}`);
      if (!text.includes(SAMPLE)) throw new Error(text);
      if (await save.isDisabled()) throw new Error("Save is off after a passing test");
      if (logged("/login-by-session", SESSION)) throw new Error("Test connection adopted the id before Save");
      await shoot("dialog_ok");
    });
    await snap("sidecar-session-01-ok");

    await step("Save stores the id and the sidecar adopts it (POST /login-by-session with it)", async () => {
      const beforeSave = savedSession();
      await save.click();
      await form.waitFor({ state: "detached", timeout: 15_000 });
      if (!logged("/login-by-session", SESSION)) throw new Error("the fake sidecar never got POST /login-by-session with the saved id");
      if (savedSession() === beforeSave) throw new Error("Save did not store IG_SESSIONID");
    });

    await step("Save closes the form; the check passed and the card keeps the sample (Ready shows it; an older pull error still shows first)", async () => {
      const checkMessage = sql("select coalesce(check_message, '') from connector_status where connector_id = 'ig-sidecar'");
      const summary = sql("select summary from connector_status where connector_id = 'ig-sidecar'");
      const view = await card.getAttribute("data-view");
      console.log(`after save: view ${view} | check_message '${checkMessage}' | sample ${JSON.parse(summary).sample}`);
      if (checkMessage || JSON.parse(summary).sample !== SAMPLE) throw new Error("the passing test was not recorded");
      if (view === "ready" && !(await card.getByTestId("sidecar-sample").innerText()).includes(SAMPLE)) throw new Error("Ready without the sample");
    });
    await snap("sidecar-session-01");

    await step("a saved id whose sample hits an Instagram limit is still saved: the form closes, the card reads the limited test with the retry time (C8)", async () => {
      await openForm();
      await input.fill(LIMITED);
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="ok"]').waitFor({ timeout: 15_000 });
      const beforeSave = savedSession();
      await fakeMode("?limitAt=1&retryAfterSec=8");
      await save.click();
      await form.waitFor({ state: "detached", timeout: 15_000 });
      await page.waitForFunction((el) => el?.getAttribute("data-view") === "limited-test", await card.elementHandle(), { timeout: 10_000 });
      const line = await card.getByTestId("sidecar-line").innerText();
      console.log(`after a limited save: ${line}`);
      if (!/^Instagram is limiting requests\. Try again after \d\d:\d\d( [AP]M)?\.$/.test(line)) throw new Error(line);
      if (!logged("/login-by-session", LIMITED)) throw new Error("the sidecar never adopted the saved id");
      if (savedSession() === beforeSave) throw new Error("the limited save did not store IG_SESSIONID");
      await fakeMode();
      await page.waitForFunction((el) => el?.getAttribute("data-view") === "error", await card.elementHandle(), { timeout: 20_000 });
      await card.getByTestId("sidecar-test").click();
      await page.waitForFunction((el) => el?.getAttribute("data-view") === "ready", await card.elementHandle(), { timeout: 15_000 });
    });
  } finally {
    await fakeMode().catch(() => {});
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
