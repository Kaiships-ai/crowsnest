import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const FAKE = `sources-01-fake-${Date.now()}`;

// Theme colors transition; without the app's disable class a snap catches text mid-fade.
async function setTheme(page, theme) {
  await page.evaluate((dark) => {
    const root = document.documentElement;
    root.classList.add("theme-transition-disabled");
    root.classList.toggle("dark", dark);
  }, theme === "dark");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.remove("theme-transition-disabled"));
}

export default async function sources01({ page, step, snap }) {
  const pane = page.getByTestId("lead-sources");
  const chatbotx = pane.locator('[data-testid="source-card"][data-connector-id="chatbotx"]');
  const dialog = page.getByTestId("source-key-dialog");
  const field = dialog.locator('[data-testid="source-key-input"][data-secret-name="CHATBOTX_API_KEY"]');

  await step("the sidebar's Sources opens Settings > Sources with every connector, grouped like Integrations", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await chatbotx.waitFor({ timeout: 10_000 });
    const listed = await call(page, "listConnectors");
    const shown = await pane.getByTestId("source-card").evaluateAll((cards) => cards.map((c) => `${c.dataset.connectorId}:${c.dataset.state}`));
    console.log(`cards: ${shown.join(" ")}`);
    const ids = shown.map((s) => s.split(":")[0]).sort();
    if (JSON.stringify(ids) !== JSON.stringify(listed.value.map((c) => c.id).sort())) throw new Error(`listConnectors ${JSON.stringify(listed.value.map((c) => c.id))}`);
    if ((await chatbotx.getAttribute("data-state")) !== "not-connected" || (await chatbotx.getByTestId("source-primary").innerText()) !== "Connect") throw new Error(await chatbotx.innerText());
  });
  await step("only the sidecar (Pull rivals) and Graph (Pull my channel) cards pull", async () => {
    const buttons = await pane.getByTestId("source-card").evaluateAll((cards) => cards.map((c) => `${c.dataset.connectorId}: ${[...c.querySelectorAll("button")].map((b) => b.innerText.trim()).join(", ")}`));
    console.log(`card buttons:\n${buttons.join("\n")}`);
    const labels = await pane.locator('[data-testid="source-card"]:not([data-connector-id="ig-sidecar"]):not([data-connector-id="instagram-graph"])').locator("button").allInnerTexts();
    if (labels.some((t) => /^Pull/.test(t.trim()))) throw new Error("a card other than the sidecar and Graph has a Pull button");
  });
  await snap("sources-01-dark");
  await setTheme(page, "light");
  await snap("sources-01-light");
  await setTheme(page, "dark");

  await step("Connect saves a fake key, closes, and the key reads only as saved", async () => {
    await chatbotx.getByTestId("source-primary").click();
    if ((await field.getAttribute("placeholder")) !== "Not set") throw new Error(`before: ${await field.getAttribute("placeholder")}`);
    await field.fill(FAKE);
    await dialog.getByTestId("source-key-save").click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await chatbotx.getByTestId("source-primary").click();
    await page.waitForFunction(() => document.querySelector('[data-secret-name="CHATBOTX_API_KEY"]')?.getAttribute("placeholder") === "Saved · paste to replace", null, { timeout: 10_000 });
    if ((await field.inputValue()) !== "") throw new Error("the field holds the key");
    if ((await page.content()).includes(FAKE)) throw new Error("the value is on screen");
    await page.keyboard.press("Escape");
  });
  await snap("sources-01-saved");

  await step("no bridge read carries the saved value", async () => {
    const names = ["getVaultBoard", "listConnectors", "getSecretStatusAction", "getFailureStrip", "getStackHealth", "getFirstRunGate", "getIgStatusAction", "listAgentActions", "listMcpTokens"];
    for (const name of names) {
      const res = await call(page, name);
      if (JSON.stringify(res).includes(FAKE)) throw new Error(`${name} carries the value`);
    }
    const refused = await call(page, "setConnectorSecret", "chatbotx", "IG_GRAPH_TOKEN", FAKE);
    if (JSON.stringify(refused).includes(FAKE) || refused.value?.ok !== false) throw new Error(JSON.stringify(refused));
    console.log(`refused: ${JSON.stringify(refused)}`);
  });

  await step("the lane DB holds the key sealed, never in plaintext", async () => {
    if (sql("select count(*) from sealed_secrets where name = 'CHATBOTX_API_KEY'") !== "1") throw new Error("no sealed row");
    if (sql("select count(*) from secrets where name = 'CHATBOTX_API_KEY'") !== "0") throw new Error("plaintext row");
    if (execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), ".dump"], { encoding: "utf8" }).includes(FAKE)) throw new Error("plaintext in the dump");
  });

  await step("Re-check shows the connection check", async () => {
    await chatbotx.getByTestId("source-recheck").click();
    const message = chatbotx.getByTestId("source-explanation");
    // The explanation updates on reload, a moment before the card leaves Checking.
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="source-card"][data-connector-id="chatbotx"]');
      return card?.dataset.state === "not-connected" && card.querySelector('[data-testid="source-explanation"]')?.textContent?.includes("not connected");
    }, null, { timeout: 10_000 });
    console.log(`check: ${await message.innerText()}`);
    if ((await chatbotx.getAttribute("data-state")) !== "not-connected") throw new Error(await chatbotx.innerText());
  });
  await snap("sources-01");
  await page.getByRole("button", { name: "Back to app" }).click();
}
