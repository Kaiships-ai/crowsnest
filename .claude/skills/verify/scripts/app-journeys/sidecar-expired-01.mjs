import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). An expired Instagram session must tell the user to
// log in again, not report a network failure they cannot act on.
export const dod = [];

const port = readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.port"), "utf8").trim();
const setSession = (state) => fetch(`http://127.0.0.1:${port}/__session?state=${state}`, { method: "POST" });
const RELOGIN = /log ?in again|re-?log ?in|reconnect|session expired|re-?authenticate/i;

export default async function sidecarExpired01({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  try {
    await step("the sidecar's Instagram session expires (fake answers login_required)", async () => {
      if (!(await setSession("expired")).ok) throw new Error("fake sidecar refused /__session");
    });

    await step("Settings > Sources: Pull again on the Instagram sidecar card fails", async () => {
      await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
      await card.waitFor({ timeout: 10_000 });
      await card.getByTestId("source-pull").click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="source-card"][data-connector-id="ig-sidecar"]')?.getAttribute("data-state") === "error",
        null,
        { timeout: 60_000 },
      );
      console.log(`card: ${(await card.innerText()).replace(/\s+/g, " ")}`);
    });
    await snap("sidecar-expired-01");

    await step("the card tells the user to log in to Instagram again", async () => {
      const text = await card.innerText();
      if (!RELOGIN.test(text)) throw new Error(`no re-login prompt: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
    });
  } finally {
    await setSession("ok");
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
