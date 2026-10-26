import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STATE = new URL("../../../../../data/verify/app/state.json", import.meta.url);
const FIXTURE = "@e2e_fixture_creator";
// SQLite refuses to rename a table under a partial index that names it, so the index goes first.
const OWN_INDEX = 'create unique index channels_single_own on channels (is_own) where "channels"."is_own" = 1';

const openFromNewTabMenu = async (page) => {
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.locator('[data-testid="new-tab-board"][data-board-id="channels"]').click();
  await page.getByRole("menu").waitFor({ state: "detached" });
};

export default async function board01({ page, step, snap }) {
  const { userDataDir } = JSON.parse(readFileSync(STATE, "utf8"));
  const sql = (statement) => execFileSync("sqlite3", [`${userDataDir}/crowsnest.db`, statement]);
  const board = page.getByTestId("board-tab");
  const fixtureRow = board.getByTestId("board-channels-row").filter({ hasText: FIXTURE });

  await step("open the channels board from the new-tab menu", async () => {
    await openFromNewTabMenu(page);
    await fixtureRow.waitFor({ timeout: 10_000 });
    console.log(`rows: ${await board.getByTestId("board-channels-row").count()}`);
  });
  await snap("board-01-ready");
  await step("opening it again reuses the tab", async () => {
    await openFromNewTabMenu(page);
    await fixtureRow.waitFor({ timeout: 10_000 });
    const views = await page.getByTestId("board-tab").count();
    if (views !== 1) throw new Error(`${views} board views`);
  });

  sql("drop index channels_single_own; alter table channels rename to channels_off");
  try {
    await step("a failed query shows the error state", async () => {
      await board.getByTestId("board-refresh").click();
      const error = board.getByTestId("board-state-error");
      await error.waitFor({ timeout: 10_000 });
      console.log(`error: ${await error.innerText()}`);
    });
    await snap("board-01-error");
  } finally {
    sql(`alter table channels_off rename to channels; ${OWN_INDEX}`);
  }
  await step("Retry brings the rows back", async () => {
    await board.getByTestId("board-retry").click();
    await fixtureRow.waitFor({ timeout: 10_000 });
  });
}
