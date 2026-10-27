import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). The session id form tests only when Test connection is
// pressed, Save stays off until a test passes, and a passing test hands the id to the sidecar.
export const dod = [];

const LOG = path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.log");
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const SESSION = `sidecar-session-01-${Date.now()}`;
const EXPIRED = `${SESSION}-expired`;
const SAMPLE = "@fake_sidecar · 2,500 followers · 30 posts";
const logged = (id) => readFileSync(LOG, "utf8").split("\n").some((l) => l.includes("POST /login-by-session") && l.includes(id));

export default async function sidecarSession01({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  const form = card.getByTestId("sidecar-session-form");
  const input = card.getByTestId("sidecar-session-input");
  const save = card.getByTestId("sidecar-form-save");
  const check = card.getByTestId("sidecar-form-check");

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
      if (logged(EXPIRED)) throw new Error("pasting tested the session");
      if (!(await save.isDisabled())) throw new Error("Save is on before a test");
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="err"]').waitFor({ timeout: 15_000 });
      const text = await check.innerText();
      console.log(`form check: ${text}`);
      if (!text.includes("The session id expired.")) throw new Error(text);
      if (!(await save.isDisabled())) throw new Error("Save is on after a failed test");
    });
    await snap("sidecar-session-01-expired");

    await step("a good id: Test connection shows Testing, then the sample, and Save turns on (C5, C6)", async () => {
      await input.fill(SESSION);
      if (!(await save.isDisabled())) throw new Error("Save is on before a test");
      await card.getByTestId("sidecar-form-test").click();
      await page.locator('[data-testid="sidecar-form-check"][data-check="ok"]').waitFor({ timeout: 15_000 });
      const text = await check.innerText();
      console.log(`form check: ${text}`);
      if (!text.includes(SAMPLE)) throw new Error(text);
      if (await save.isDisabled()) throw new Error("Save is off after a passing test");
    });
    await snap("sidecar-session-01-ok");

    await step("the sidecar adopted the tested session (POST /login-by-session with it)", async () => {
      if (!logged(SESSION)) throw new Error("the fake sidecar never got POST /login-by-session with the tested id");
    });

    await step("Save closes the form; the check passed and the card keeps the sample (Ready shows it; an older pull error still shows first)", async () => {
      await save.click();
      await form.waitFor({ state: "detached", timeout: 10_000 });
      const checkMessage = sql("select coalesce(check_message, '') from connector_status where connector_id = 'ig-sidecar'");
      const summary = sql("select summary from connector_status where connector_id = 'ig-sidecar'");
      const view = await card.getAttribute("data-view");
      console.log(`after save: view ${view} | check_message '${checkMessage}' | sample ${JSON.parse(summary).sample}`);
      if (checkMessage || JSON.parse(summary).sample !== SAMPLE) throw new Error("the passing test was not recorded");
      if (view === "ready" && !(await card.getByTestId("sidecar-sample").innerText()).includes(SAMPLE)) throw new Error("Ready without the sample");
    });
    await snap("sidecar-session-01");
  } finally {
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
