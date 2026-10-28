import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). An expired Instagram session must tell the user to
// log in again, not report a network failure they cannot act on.
export const dod = [];

const port = readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.port"), "utf8").trim();
const setSession = (state) => fetch(`http://127.0.0.1:${port}/__session?state=${state}`, { method: "POST" });
const RELOGIN = "The session id expired. Sign in to instagram.com and copy a new session id.";

export default async function sidecarExpired01({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  try {
    await step("the sidecar's Instagram session expires (fake answers login_required)", async () => {
      if (!(await setSession("expired")).ok) throw new Error("fake sidecar refused /__session");
    });

    await step("a sidecar pull fails, and Settings > Sources shows it on the Instagram sidecar card", async () => {
      // The card has no Pull: pull through the bridge, then open Sources, which reads the recorded state.
      const pulled = await page.evaluate(() => window.api.crowsnest.call("pullConnector", "ig-sidecar"));
      await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
      await card.waitFor({ timeout: 10_000 });
      // An earlier journey may have left the card in error, so check this pull's own recorded
      // row first, then wait for the card to show it.
      if (!pulled.ok || pulled.value.state !== "error" || !pulled.value.detail?.includes(RELOGIN)) throw new Error(`pull row: ${JSON.stringify(pulled)}`);
      await page.waitForFunction(
        (sel) => document.querySelector(sel)?.getAttribute("data-state") === "error",
        '[data-testid="source-card"][data-connector-id="ig-sidecar"]',
        { timeout: 10_000 },
      );
      console.log(`card: ${(await card.innerText()).replace(/\s+/g, " ")}`);
    });
    await snap("sidecar-expired-01");

    await step("the card tells the user to log in to Instagram again", async () => {
      const text = await card.innerText();
      if (!text.includes(RELOGIN)) throw new Error(`no re-login prompt: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    });
  } finally {
    await setSession("ok");
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
