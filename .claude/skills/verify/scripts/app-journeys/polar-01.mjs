import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Polar card on the fake Polar (boards-lane.sh starts it and sets POLAR_API_URL).
const APP = path.resolve(import.meta.dirname, "../../../../../data/verify/app");
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const polarUrl = `http://127.0.0.1:${readFileSync(path.join(APP, "fake-polar.port"), "utf8").trim()}`;
const polarCalls = () => readFileSync(path.join(APP, "fake-polar.log"), "utf8").split("\n").filter((l) => l.includes("GET /v1/organizations")).length;
const setMode = (m) => fetch(`${polarUrl}/__mode?m=${m}`, { method: "POST" });

const GOOD = "polar_oat_lane_good";
const BAD = "polar_oat_lane_bad";
const REJECTED = "Polar rejected the token (401). Create a new organization token and paste it.";
const UNREACHABLE = "Cannot reach Polar. Check your internet connection, then test again.";
const CARD = '[data-testid="source-card"][data-connector-id="polar"]';

async function setTheme(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function polar01({ page, step, snap }) {
  const card = page.locator(CARD);
  const form = card.getByTestId("polar-form");
  const input = card.getByTestId("polar-token-input");
  const check = card.getByTestId("polar-form-check");
  const save = card.getByTestId("polar-form-save");
  const test = card.getByTestId("polar-form-test");
  const text = async () => (await card.innerText()).replace(/\s+/g, " ");
  const waitState = (state) => page.waitForFunction(([sel, s]) => document.querySelector(sel)?.dataset.state === s, [CARD, state], { timeout: 15_000 });
  const shoot = async (name) => {
    await card.scrollIntoViewIfNeeded();
    await snap(`polar-${name}-dark`);
    await setTheme(page, "light");
    await snap(`polar-${name}-light`);
    await setTheme(page, "dark");
  };

  await step("Sources: Polar is Not connected, with Enter access token and no Pull button", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await card.waitFor({ timeout: 10_000 });
    const t = await text();
    console.log(`card: ${t}`);
    if ((await card.getAttribute("data-state")) !== "not-connected" || !t.includes("Not connected") || !t.includes("Orders and revenue. Needs an organization access token.")) throw new Error(t);
    const buttons = await card.locator("button").allInnerTexts();
    console.log(`buttons: ${buttons.join(", ")}`);
    if (buttons.some((b) => /^Pull/.test(b.trim()))) throw new Error("the Polar card has a Pull button");
  });
  await shoot("not-connected");

  await step("Enter access token opens the form: Test connection and Save are off while it is empty", async () => {
    await card.getByTestId("polar-enter").click();
    await form.waitFor();
    if (!(await test.isDisabled()) || !(await save.isDisabled())) throw new Error("a button is on with no token");
  });
  await shoot("dialog-empty");

  await step("pasting a token tests nothing: Polar sees no call and Save stays off", async () => {
    const before = polarCalls();
    await input.fill(BAD);
    await page.waitForTimeout(1000);
    console.log(`Polar calls before paste ${before}, after ${polarCalls()}`);
    if (polarCalls() !== before) throw new Error("the paste called Polar");
    if (await test.isDisabled()) throw new Error("Test connection is off with a token");
    if (!(await save.isDisabled())) throw new Error("Save is on before a test");
  });
  await shoot("dialog-pasted");

  await step("Test connection with a wrong token shows Testing, then the 401 inside the form; Save stays off", async () => {
    await setMode("slow");
    await test.click();
    await card.locator('[data-testid="polar-form-check"][data-check="testing"]').waitFor();
    await shoot("dialog-testing");
    await setMode("up");
    await card.locator('[data-testid="polar-form-check"][data-check="err"]').waitFor({ timeout: 15_000 });
    console.log(`form: ${await check.innerText()}`);
    if ((await check.innerText()) !== REJECTED) throw new Error(await check.innerText());
    if (!(await save.isDisabled())) throw new Error("Save is on after a failed test");
  });
  await shoot("dialog-err");

  await step("Cancel leaves the card unchanged and stores nothing", async () => {
    await card.getByTestId("polar-form-cancel").click();
    await form.waitFor({ state: "detached" });
    await waitState("not-connected");
    const sealed = sql("select count(*) from sealed_secrets where name = 'POLAR_ACCESS_TOKEN'");
    const rows = sql("select count(*) from connector_status where connector_id = 'polar'");
    console.log(`sealed POLAR_ACCESS_TOKEN rows ${sealed}, polar status rows ${rows}`);
    if (sealed !== "0" || rows !== "0") throw new Error("Cancel stored something");
  });

  await step("a good token shows Token works · organization Kaiships, and Save turns on", async () => {
    await card.getByTestId("polar-enter").click();
    await input.fill(GOOD);
    await test.click();
    await card.locator('[data-testid="polar-form-check"][data-check="ok"]').waitFor({ timeout: 15_000 });
    console.log(`form: ${await check.innerText()}`);
    if ((await check.innerText()) !== "✓ Token works · organization Kaiships") throw new Error(await check.innerText());
    if (await save.isDisabled()) throw new Error("Save is off after a pass");
  });
  await shoot("dialog-ok");

  await step("Save stores the token without testing again; the card is Ready with the organization and no Pull", async () => {
    const before = polarCalls();
    const started = Date.now();
    await save.click();
    await waitState("ready");
    console.log(`save to Ready: ${Date.now() - started} ms; Polar calls on save: ${polarCalls() - before}`);
    if (polarCalls() !== before) throw new Error("Save called Polar");
    const t = await text();
    console.log(`card: ${t}`);
    if (!/Organization Kaiships · tested \d{1,2}:\d{2}/.test(t) || !t.includes("Pulling orders comes in a later release. The key is saved and tested.")) throw new Error(t);
    const buttons = (await card.locator("button").allInnerTexts()).map((b) => b.trim());
    if (JSON.stringify(buttons) !== JSON.stringify(["Test connection", "Change token"])) throw new Error(`buttons ${buttons}`);
    if ((await page.content()).includes(GOOD)) throw new Error("the token is on screen");
    const sealed = sql("select count(*) from sealed_secrets where name = 'POLAR_ACCESS_TOKEN'");
    const plain = sql("select count(*) from secrets where name = 'POLAR_ACCESS_TOKEN'");
    const org = sql("select value from app_settings where key = 'polar_organization'");
    const status = sql("select coalesce(check_message, 'null') || ' ' || (checked_at is not null) from connector_status where connector_id = 'polar'");
    console.log(`sealed ${sealed}, plaintext ${plain}, organization ${org}, status ${status}`);
    if (sealed !== "1" || plain !== "0" || org !== "Kaiships" || status !== "null 1") throw new Error("the lane DB does not match");
  });
  await shoot("ready");

  await step("Test connection on the card shows Testing, then Ready again", async () => {
    await setMode("slow");
    await card.getByTestId("polar-test").click();
    await waitState("testing");
    if (!(await text()).includes("Testing the token with Polar…")) throw new Error(await text());
    await shoot("checking");
    await setMode("up");
    await waitState("ready");
  });

  await step("Polar unreachable: Test connection turns the card to Error with what to do", async () => {
    await setMode("down");
    await card.getByTestId("polar-test").click();
    await waitState("error");
    console.log(`card: ${await text()}`);
    if (!(await text()).includes(UNREACHABLE)) throw new Error(await text());
  });
  await shoot("unreachable");

  await step("a revoked token: Test connection turns the card to Error with the 401", async () => {
    await setMode("revoked");
    await card.getByTestId("polar-test").click();
    await page.waitForFunction(([sel, msg]) => document.querySelector(sel)?.innerText.includes(msg), [CARD, REJECTED], { timeout: 15_000 });
    const buttons = (await card.locator("button").allInnerTexts()).map((b) => b.trim());
    console.log(`card: ${await text()} | buttons ${buttons}`);
    if (JSON.stringify(buttons) !== JSON.stringify(["Change token", "Test connection"])) throw new Error(`buttons ${buttons}`);
    if (sql("select check_message from connector_status where connector_id = 'polar'") !== REJECTED) throw new Error("the 401 is not recorded");
  });
  await shoot("error-401");

  await step("Polar accepts the token again: Test connection brings the card back to Ready", async () => {
    await setMode("up");
    await card.getByTestId("polar-test").click();
    await waitState("ready");
  });
  await page.getByRole("button", { name: "Back to app" }).click();
}
