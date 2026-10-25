import {
  countVisibleTerminalPanes,
  focusActiveTerminalInput,
  getTerminalContent,
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
} from "../../../../../tests/e2e/helpers/terminal.ts";

const until = async (probe, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
};
const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, "g");

export default async function shell01({ page, step, snap }) {
  await step("window", async () => {
    const title = await page.title();
    if (!title.includes("Lead Studio")) throw new Error(`title is "${title}"`);
  });
  await step("terminal echo", async () => {
    await waitForActiveTerminalManager(page, 15_000);
    await focusActiveTerminalInput(page);
    await page.keyboard.type("echo hi");
    await page.keyboard.press("Enter");
    await until(
      async () => (await getTerminalContent(page)).replace(ANSI, "").split(/\r?\n/).some((l) => l.trim() === "hi"),
      10_000,
      'a line that is exactly "hi"',
    );
  });
  await step("split", async () => {
    await splitActiveTerminalPane(page, "vertical");
    await until(async () => (await countVisibleTerminalPanes(page)) === 2, 10_000, "2 terminal panes");
  });
  await snap("shell-01");
}
