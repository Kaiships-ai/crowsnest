import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const APP = path.join(ROOT, "data/verify/app");
export const port = (name) => readFileSync(path.join(APP, `${name}.port`), "utf8").trim();
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
export const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();
export const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
export const post = async (name, route) => {
  if (!(await fetch(`http://127.0.0.1:${port(name)}/${route}`, { method: "POST" })).ok) throw new Error(`${name} refused /${route}`);
};
export const GRAPH = '[data-testid="source-card"][data-connector-id="instagram-graph"]';
export const SIDECAR = '[data-testid="source-card"][data-connector-id="ig-sidecar"]';
export const waitView = (page, sel, want, timeout = 60_000) =>
  page.waitForFunction(([sel, want]) => document.querySelector(sel)?.getAttribute("data-view") === want, [sel, want], { timeout });
export const waitDone = (page, sel, n, timeout = 60_000) =>
  page.waitForFunction(([sel, n]) => Number(document.querySelector(sel)?.querySelector('[data-testid="source-pull-count"]')?.innerText.split(" / ")[0] ?? -1) >= n, [sel, n], { timeout });
export const openSources = async (page) => {
  await page.getByRole("button", { name: "Back to app" }).click({ timeout: 2_000 }).catch(() => {});
  await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
  await page.locator(GRAPH).waitFor({ timeout: 10_000 });
};
export const summaryOf = (id) => JSON.parse(sql(`select summary from connector_status where connector_id = '${id}'`) || "{}").pull;
