import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on card-state-lane.sh after the app quit and reopened on card-state-01's DB. Nothing pulls or
// checks on start, so the card shows the state it had when the app quit.
export const dod = [];

const APP = path.resolve(import.meta.dirname, "../../../../../data/verify/app");
const { userDataDir } = JSON.parse(readFileSync(path.join(APP, "state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();

export default async function cardState02({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  await step("after the restart the sidecar card still shows the last pull's Error and its reason", async () => {
    await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
    await card.waitFor({ timeout: 10_000 });
    const [state, detail] = sql("select state || char(9) || detail from connector_status where connector_id = 'ig-sidecar'").split("\t");
    const text = (await card.innerText()).replace(/\s+/g, " ");
    console.log(`db: ${state} | ${detail}`);
    console.log(`card: ${text}`);
    if (state !== "error" || (await card.getAttribute("data-state")) !== "error") throw new Error(`state ${state}`);
    if (!text.includes(detail)) throw new Error("the card lost the pull's reason");
  });
  await step("no check or pull ran on start: connector_status holds the same one row per event", async () => {
    const rows = sql("select connector_id || ' ' || state from connector_status order by connector_id");
    console.log(`connector_status:\n${rows}`);
    if (rows !== "ig-sidecar error") throw new Error("a connector was checked or pulled on start");
  });
  await snap("card-state-02-after-restart");
}
