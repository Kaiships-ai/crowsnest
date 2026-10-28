import { GRAPH, SIDECAR, openSources, post, sql, summaryOf, waitView } from "./crash-rest-common.mjs";

// After the relaunch on the mid-pull DB: both cards read Partial, and Pull the rest continues pull B's count.
export const dod = [];

export default async function crashRest02({ page, step, snap }) {
  const graph = page.locator(GRAPH);
  const sidecar = page.locator(SIDECAR);
  const start = {};
  await step("after the relaunch both cards read Partial with pull B's done count", async () => {
    await openSources(page);
    for (const [id, sel, view] of [["instagram-graph", GRAPH, "partial"], ["ig-sidecar", SIDECAR, "off-mid"]]) {
      await waitView(page, sel, view, 10_000);
      const row = sql(`select started_at || ' ' || progress_done || ' ' || progress_total from connector_status where connector_id = '${id}'`).split(" ");
      start[id] = { at: row[0], done: Number(row[1]), total: Number(row[2]) };
      const line = (await page.locator(sel).innerText()).replace(/\s+/g, " ");
      console.log(`${id}: ${line} | B started ${row[0]}, ${row[1]}/${row[2]}`);
      if (!line.includes(`${row[1]}/${row[2]}`) || !line.includes(`Pull the rest (${row[2] - row[1]})`)) throw new Error(line);
      if (!line.includes(`The pull stopped before it finished, at ${row[1]}/${row[2]}`)) throw new Error(`a lost pull reads as finished: ${line}`);
    }
    await snap("crash-rest-02-partial");
  });

  await step("Pull the rest on the Graph card measures only the posts B never reached and reads 10/10", async () => {
    const b = start["instagram-graph"];
    await post("fake-graph", "__mode?posts=10");
    await graph.getByTestId("graph-pull-rest").click();
    await waitView(page, GRAPH, "done", 60_000);
    const perPost = sql(`select group_concat(n) from (select count(*) n from own_post_insights where captured_at >= '${b.at}' group by own_post_id)`);
    const posts = sql(`select count(distinct own_post_id) from own_post_insights where captured_at >= '${b.at}'`);
    const head = (await graph.getByTestId("source-pull-summary").innerText()).split("\n")[0];
    const pull = summaryOf("instagram-graph");
    console.log(`graph rest: ${head} | posts measured since B ${posts}, times each ${perPost} | chainFrom ${pull.chainFrom}`);
    if (!head.includes("Pulled 10/10 posts")) throw new Error(head);
    if (posts !== "10" || perPost.split(",").some((n) => n !== "1")) throw new Error(`a post measured twice since B: ${perPost}`);
    if (pull.chainFrom !== b.at || pull.done !== 10) throw new Error(JSON.stringify(pull));
  });

  await step("Pull the rest on the sidecar card pulls only the rivals B never reached and reads N/N", async () => {
    const b = start["ig-sidecar"];
    await post("fake-sidecar", "__medias?state=empty");
    await sidecar.getByTestId("sidecar-pull-rest").click();
    await waitView(page, SIDECAR, "done", 90_000);
    const head = (await sidecar.getByTestId("source-pull-summary").innerText()).split("\n")[0];
    const pull = summaryOf("ig-sidecar");
    const synced = Number(sql(`select count(*) from channels where deleted_at is null and is_own = 0 and last_successful_sync_at >= '${b.at}'`));
    const profiles = sql("select count(*) from channels where deleted_at is null and is_own = 0");
    console.log(`sidecar rest: ${head} | rivals synced since B ${synced} of ${profiles} | chainFrom ${pull.chainFrom}, ${pull.done}/${pull.total}`);
    if (!head.includes(`Pulled ${b.total}/${b.total} rivals`)) throw new Error(head);
    if (pull.chainFrom !== b.at || pull.done !== b.total || synced !== b.total) throw new Error(JSON.stringify(pull));
    await snap("crash-rest-02-done");
  });
}
