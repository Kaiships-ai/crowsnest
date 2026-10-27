import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on card-state-lane.sh (fake sidecar), before the restart; card-state-02 runs after it.
// Each Sources card shows one state: the newest check or pull, read from connector_status.
export const dod = [];

const APP = path.resolve(import.meta.dirname, "../../../../../data/verify/app");
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const port = readFileSync(path.join(APP, "fake-sidecar.port"), "utf8").trim();
const setSession = (state) => fetch(`http://127.0.0.1:${port}/__session?state=${state}`, { method: "POST" });
const SELECTOR = '[data-testid="source-card"][data-connector-id="ig-sidecar"]';

/** Waits until the sidecar card is idle in `state`. */
async function settle(page, state) {
  await page.waitForFunction(
    ([sel, want]) => {
      const c = document.querySelector(sel);
      return c?.getAttribute("data-state") === want && !c.querySelector('[data-testid="source-recheck"]')?.hasAttribute("disabled");
    },
    [SELECTOR, state],
    { timeout: 60_000 },
  );
}

/** Clicks a card button and waits for the call to end with the card in `state`. */
async function press(page, card, testId, state) {
  await card.getByTestId(testId).click();
  await settle(page, state);
}

/** The card has no Pull, so the sidecar pulls through the bridge and Sources reopens to read the new state. */
async function pull(page, card, state) {
  await page.evaluate(() => window.api.crowsnest.call("pullConnector", "ig-sidecar"));
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
  await card.waitFor({ timeout: 10_000 });
  await settle(page, state);
}

const pills = (card) => card.evaluate((c) => [...c.querySelectorAll("span")].filter((s) => /^(Ready|Error|Partial|Not configured|Checking|Pulling|Verified)$/.test(s.innerText.trim())).map((s) => s.innerText.trim()));

export default async function cardState01({ page, step, snap }) {
  const card = page.locator(SELECTOR);
  try {
    await step("Settings > Sources: no card names a next pull time or has a Pull button", async () => {
      await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
      await card.waitFor({ timeout: 10_000 });
      const text = await page.getByTestId("lead-sources").innerText();
      console.log(`pull lines: ${(await page.getByTestId("source-pulls").allInnerTexts()).join(" | ")}`);
      if (/\bnext\b|05:00/i.test(text)) throw new Error(`a card names a scheduled pull: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
      if (await page.getByTestId("lead-sources").getByRole("button", { name: "Pull", exact: true }).count()) throw new Error("a card has a Pull button");
    });

    await step("the sidecar's session expires and a pull fails: the card shows Error with its reason", async () => {
      if (!(await setSession("expired")).ok) throw new Error("fake sidecar refused /__session");
      await pull(page, card, "error");
      console.log(`card: ${(await card.innerText()).replace(/\s+/g, " ")}`);
      console.log(`db: ${sql("select state || ' | ' || coalesce(detail, '') from connector_status where connector_id = 'ig-sidecar'")}`);
      const shown = await pills(card);
      if (JSON.stringify(shown) !== '["Error"]') throw new Error(`pills ${JSON.stringify(shown)}`);
    });
    await snap("card-state-01-error");

    await step("the session is back and Re-check passes: the card shows only Ready, no Error and no Verified", async () => {
      await setSession("ok");
      await press(page, card, "source-recheck", "ready");
      const text = (await card.innerText()).replace(/\s+/g, " ");
      console.log(`card: ${text}`);
      const shown = await pills(card);
      if (JSON.stringify(shown) !== '["Ready"]') throw new Error(`pills ${JSON.stringify(shown)}`);
      if (/Error|Verified|failed/.test(text)) throw new Error("the card still shows the old error");
      const row = sql("select state || ' ' || (checked_at > pulled_at) from connector_status where connector_id = 'ig-sidecar'");
      console.log(`db state, checked after pull: ${row}`);
      if (row !== "ready 1") throw new Error(`db ${row}`);
    });
    await snap("card-state-01-ready");

    await step("a pull fails again, leaving Error as the newest event for the restart", async () => {
      await setSession("expired");
      await pull(page, card, "error");
      const row = sql("select state || ' | ' || detail || ' | ' || pulled_at from connector_status where connector_id = 'ig-sidecar'");
      console.log(`db before restart: ${row}`);
      if (!row.startsWith("error | ")) throw new Error(`db ${row}`);
    });
  } finally {
    await setSession("ok");
  }
}
