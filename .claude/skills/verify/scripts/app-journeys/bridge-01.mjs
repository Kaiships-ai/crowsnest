const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);

export default async function bridge01({ page, step, snap }) {
  await step("query returns seeded rows", async () => {
    const res = await call(page, "getChannelsList");
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    const handles = res.value.map((c) => c.handle);
    console.log(`getChannelsList: ${JSON.stringify(handles)}`);
    if (!handles.includes("@e2e_fixture_creator")) throw new Error(`handles ${JSON.stringify(handles)}`);
  });
  await step("query with an argument", async () => {
    const list = await call(page, "getChannelsList");
    const res = await call(page, "getChannelDetail", list.value[0].id);
    if (!res.ok || res.value?.channel.handle !== "@e2e_fixture_creator") throw new Error(JSON.stringify(res));
    console.log(`getChannelDetail: ${res.value.channel.handle}, ${res.value.videos.length} videos`);
  });
  await step("secret status carries no value", async () => {
    const res = await call(page, "getSecretStatusAction");
    const text = JSON.stringify(res);
    if (!res.ok || text.includes("e2e-junk-graph-token")) throw new Error(text);
    const graph = res.value.find((s) => s.name === "IG_GRAPH_TOKEN");
    if (!graph?.configured) throw new Error(text);
    console.log(`getSecretStatusAction: ${JSON.stringify(graph)}`);
  });
  await step("bad arguments are a typed error", async () => {
    const res = await call(page, "getChannelDetail", 42);
    if (res.ok || res.error.code !== "bad_args") throw new Error(JSON.stringify(res));
    console.log(`getChannelDetail(42): ${res.error.code}`);
  });
  await step("unknown call is a typed error", async () => {
    const res = await call(page, "publishNowAction", "plan-1");
    if (res.ok || res.error.code !== "unknown_call") throw new Error(JSON.stringify(res));
    console.log(`publishNowAction: ${res.error.code}`);
  });
  await snap("bridge-01");
}
