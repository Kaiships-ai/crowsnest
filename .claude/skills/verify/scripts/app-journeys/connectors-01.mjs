import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const call = (page, name, ...args) => page.evaluate(([name, args]) => window.api.crowsnest.call(name, ...args), [name, args]);
const SEEDED_TOKEN = "e2e-junk-graph-token";
const { userDataDir } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../data/verify/app/state.json"), "utf8"));
const sql = (query) => execFileSync("sqlite3", [path.join(userDataDir, "crowsnest.db"), query], { encoding: "utf8" }).trim();

export default async function connectors01({ page, step, snap }) {
  let connectors;
  await step("the bridge lists every connector with its state", async () => {
    const res = await call(page, "listConnectors");
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    connectors = res.value;
    const states = Object.fromEntries(connectors.map((c) => [c.id, c.status]));
    console.log(`listConnectors: ${JSON.stringify(states)}`);
    if (states.chatbotx !== "not-connected") throw new Error(`chatbotx is ${states.chatbotx}`);
    for (const id of ["umami", "polar"]) if (!["needs-setup", "configured"].includes(states[id])) throw new Error(`${id} is ${states[id]}`);
    if (states["instagram-graph"] !== "configured") throw new Error(`instagram-graph is ${states["instagram-graph"]}`);
  });
  await step("the seeded Graph token moved to the keychain on boot and no value crosses the bridge", async () => {
    const graph = connectors.find((c) => c.id === "instagram-graph");
    const token = graph.secrets.find((s) => s.name === "IG_GRAPH_TOKEN");
    console.log(`IG_GRAPH_TOKEN: ${JSON.stringify(token)}`);
    if (token.source !== "keychain") throw new Error(`source ${token.source}`);
    if (JSON.stringify(connectors).includes(SEEDED_TOKEN)) throw new Error("listConnectors carries the token");
  });
  await step("the lane DB holds no plaintext secret", async () => {
    const legacy = sql("select count(*) from secrets");
    const sealed = sql("select count(*) from sealed_secrets");
    const leaked = sql(`select count(*) from sealed_secrets where sealed like '%${SEEDED_TOKEN}%'`);
    console.log(`secrets rows: ${legacy}, sealed_secrets rows: ${sealed}, sealed rows holding the plaintext: ${leaked}`);
    if (legacy !== "0" || sealed === "0" || leaked !== "0") throw new Error("plaintext left in SQLite");
  });
  await step("a manifest-only connector is never called", async () => {
    const res = await call(page, "testConnector", "chatbotx");
    console.log(`testConnector(chatbotx): ${JSON.stringify(res)}`);
    if (!res.ok || res.value.ok !== false) throw new Error(JSON.stringify(res));
  });
  await snap("connectors-01");
}
