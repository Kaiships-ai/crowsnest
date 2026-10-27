import { readFileSync } from "node:fs";
import path from "node:path";

// Runs on boards-lane.sh (fake sidecar). Saving a browser session id must hand it to the
// sidecar, or the sidecar never logs in with it.
export const dod = [];

const LOG = path.resolve(import.meta.dirname, "../../../../../data/verify/app/fake-sidecar.log");
const SESSION = `sidecar-session-01-${Date.now()}`;

export default async function sidecarSession01({ page, step, snap }) {
  const card = page.locator('[data-testid="source-card"][data-connector-id="ig-sidecar"]');
  const dialog = page.getByTestId("source-key-dialog");

  try {
    await step("Settings > Sources: save a Browser session id on the Instagram sidecar card", async () => {
      await page.locator('[data-testid="ls-nav-row"][data-nav-id="sources"]').click();
      await card.waitFor({ timeout: 10_000 });
      await card.getByTestId("source-primary").click();
      await dialog.locator('[data-testid="source-key-input"][data-secret-name="IG_SESSIONID"]').fill(SESSION);
      await dialog.getByTestId("source-key-save").click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 });
    });

    await step("the sidecar adopts the saved session (POST /login-by-session with it)", async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (readFileSync(LOG, "utf8").split("\n").some((l) => l.includes("POST /login-by-session") && l.includes(SESSION))) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("the fake sidecar never got POST /login-by-session with the saved id");
    });
    await snap("sidecar-session-01");
  } finally {
    await page.getByRole("button", { name: "Back to app" }).click({ timeout: 5_000 }).catch(() => {});
  }
}
