import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
const FAKE = `vault-01-fake-${Date.now()}`;

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

export default async function vault01({ page, step, snap }) {
  const board = page.getByTestId("board-tab");
  const polar = board.locator('[data-testid="vault-row"][data-connector-id="polar"]');

  await step("open the Vault board from the new-tab menu and see every connector", async () => {
    await page.getByRole("button", { name: "New tab" }).first().click();
    await page.locator('[data-testid="new-tab-board"][data-board-id="vault"]').click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await polar.waitFor({ timeout: 10_000 });
    const listed = await call(page, "listConnectors");
    const shown = await board.getByTestId("vault-row").evaluateAll((rows) => rows.map((r) => `${r.dataset.connectorId}:${r.dataset.state}`));
    console.log(`rows: ${shown.join(" ")}`);
    const ids = shown.map((s) => s.split(":")[0]);
    if (JSON.stringify(ids) !== JSON.stringify(listed.value.map((c) => c.id))) throw new Error(`listConnectors ${JSON.stringify(listed.value.map((c) => c.id))}`);
  });
  await snap("vault-01-dark");
  await setTheme(page, "light");
  await snap("vault-01-light");
  await setTheme(page, "dark");

  await step("Sửa saves a fake secret, clears the input and shows only where it is stored", async () => {
    const status = polar.getByTestId("vault-secret-status");
    await polar.getByTestId("vault-edit").click();
    if ((await status.innerText()) !== "chưa có") throw new Error(`before: ${await status.innerText()}`);
    await polar.getByTestId("vault-secret-input").fill(FAKE);
    await polar.getByTestId("vault-secret-save").click();
    await status.filter({ hasText: "đã lưu · nguồn keychain" }).waitFor({ timeout: 10_000 });
    console.log(`status: ${await status.innerText()}`);
    const input = await polar.getByTestId("vault-secret-input").inputValue();
    if (input !== "") throw new Error(`input still holds ${input.length} chars`);
    if ((await page.content()).includes(FAKE)) throw new Error("the value is on screen");
  });
  await snap("vault-01-saved");

  await step("no bridge read carries the saved value", async () => {
    const names = ["getVaultBoard", "listConnectors", "getSecretStatusAction", "getFailureStrip", "getStackHealth", "getFirstRunGate", "getIgStatusAction", "listAgentActions", "listMcpTokens"];
    for (const name of names) {
      const res = await call(page, name);
      if (JSON.stringify(res).includes(FAKE)) throw new Error(`${name} carries the value`);
    }
    const again = await call(page, "setConnectorSecret", "polar", "POLAR_ACCESS_TOKEN", FAKE);
    if (JSON.stringify(again) !== '{"ok":true,"value":{"ok":true}}') throw new Error(JSON.stringify(again));
    const refused = await call(page, "setConnectorSecret", "polar", "IG_GRAPH_TOKEN", FAKE);
    if (JSON.stringify(refused).includes(FAKE) || refused.value?.ok !== false) throw new Error(JSON.stringify(refused));
    console.log(`refused: ${JSON.stringify(refused)}`);
  });

  await step("the lane DB holds the key sealed, never in plaintext", async () => {
    if (sql("select count(*) from sealed_secrets where name = 'POLAR_ACCESS_TOKEN'") !== "1") throw new Error("no sealed row");
    if (sql("select count(*) from secrets where name = 'POLAR_ACCESS_TOKEN'") !== "0") throw new Error("plaintext row");
    if (execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), ".dump"], { encoding: "utf8" }).includes(FAKE)) throw new Error("plaintext in the dump");
  });

  await step("Kiểm tra shows the connection check", async () => {
    await polar.getByTestId("vault-test").click();
    const message = polar.getByTestId("vault-message");
    await message.waitFor({ timeout: 10_000 });
    console.log(`check: ${await message.innerText()}`);
    if (!(await message.innerText()).includes("not connected")) throw new Error(await message.innerText());
  });
  await snap("vault-01");
}
