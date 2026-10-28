import { GRAPH, SIDECAR, call, openSources, post, sql, waitDone, waitView } from "./crash-rest-common.mjs";

// Before the quit: a full pull A on both cards, then a full pull B on both left running for the lane to quit the app.
export const dod = [];
const RIVALS = Array.from({ length: 10 }, (_, i) => `@crash_rival_${String(i + 1).padStart(2, "0")}`);

export default async function crashRest01({ page, step, snap }) {
  const graph = page.locator(GRAPH);
  const sidecar = page.locator(SIDECAR);
  await step("setup: the Graph token is saved and 10 rivals are tracked", async () => {
    await post("fake-sidecar", "__medias?state=empty");
    for (const handle of RIVALS) {
      const res = await call(page, "addChannelAction", handle);
      if (!res.ok || !res.value.ok) throw new Error(`add ${handle}: ${JSON.stringify(res)}`);
    }
    await openSources(page);
    if ((await graph.getAttribute("data-view")) !== "ready") {
      await graph.getByTestId("graph-enter").click();
      await graph.getByTestId("graph-token-input").fill("IGAAfake-crash-token");
      await graph.getByTestId("graph-form-test").click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-testid="graph-form-check"]')?.getAttribute("data-check") === "ok", GRAPH, { timeout: 15_000 });
      await graph.getByTestId("graph-form-save").click();
      await waitView(page, GRAPH, "ready", 10_000);
    }
  });

  await step("pull A on both cards finishes: 10/10 posts and every rival", async () => {
    await post("fake-graph", "__mode?posts=10");
    await graph.getByTestId("graph-pull").click();
    await waitView(page, GRAPH, "done", 60_000);
    await sidecar.getByTestId("sidecar-pull").click();
    await waitView(page, SIDECAR, "done", 90_000);
    console.log(`A: graph ${(await graph.getByTestId("source-pull-summary").innerText()).split("\n")[0]} | sidecar ${(await sidecar.getByTestId("source-pull-summary").innerText()).split("\n")[0]}`);
  });

  await step("pull B on both cards is running (Graph at 4/10 or more, the sidecar at 3 or more) when the app quits", async () => {
    await page.waitForTimeout(1_500);
    await post("fake-graph", "__mode?posts=10&delayMs=1500");
    await post("fake-sidecar", "__mode?delayMs=2500");
    await graph.getByTestId("graph-pull").click();
    await sidecar.getByTestId("sidecar-pull").click();
    await waitDone(page, GRAPH, 4, 60_000);
    await waitDone(page, SIDECAR, 3, 60_000);
    await snap("crash-rest-01-pulling");
    console.log(`B at quit: ${sql("select connector_id || ' ' || pull_state || ' ' || progress_done || '/' || progress_total || ' from ' || started_at from connector_status where pull_state = 'pulling'").replace(/\n/g, " | ")}`);
  });
}
