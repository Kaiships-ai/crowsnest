import { beforeEach, describe, expect, test } from "vitest";
import type { ConnectionCheck, Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import type { PullResult } from "@/server/lib/pull-result";
import { checkConnector, pullConnector } from "@/server/services/connector-status";
import { getVaultBoard } from "./vault-board";

type Pull = () => Promise<PullResult<unknown, unknown>>;

function fake(id: string, opts: { pull?: Pull; check?: () => Promise<ConnectionCheck>; adapter?: boolean; secret?: boolean } = {}): Connector {
  const testConnection = opts.check ?? (async () => ({ ok: true, message: null }));
  const adapter = opts.adapter === false ? null : opts.pull ? { testConnection, pull: opts.pull } : { testConnection };
  const secrets = opts.secret ? [{ name: `VAULT_TEST_${id.toUpperCase()}`, label: "API key" }] : [];
  return { manifest: { id, label: id, auth: "api-key", secrets, feeds: [] }, adapter };
}

const complete: Pull = async () => ({ kind: "complete", rows: null });
const card = (registry: Connector[], id: string) => {
  const row = getVaultBoard(new Date(), registry).find((r) => r.id === id);
  return row && { state: row.state, message: row.message, detail: row.detail };
};

beforeEach(async () => {
  migrate();
  await db.delete(tables.connectorStatus);
});

describe("getVaultBoard", () => {
  test("a pull's outcome is the card's one state", async () => {
    const registry = [
      fake("ok", { pull: complete }),
      fake("cut", { pull: async () => ({ kind: "partial", rows: null, missing: "page 2", reason: "rate limited" }) }),
      fake("down", { pull: async () => ({ kind: "failed", reason: "sidecar down" }) }),
      fake("throws", { pull: async () => {
        throw new Error("ECONNREFUSED");
      } }),
    ];
    for (const c of registry) await pullConnector(c.manifest.id, registry);
    expect(card(registry, "ok")).toEqual({ state: "ready", message: null, detail: null });
    expect(card(registry, "cut")).toEqual({ state: "partial", message: "The last pull did not finish, so the older numbers stay. Pull again later.", detail: "missing page 2: rate limited" });
    expect(card(registry, "down")).toEqual({ state: "error", message: "The last pull failed, so the older numbers stay. Check the key, then pull again.", detail: "sidecar down" });
    expect(card(registry, "throws")).toMatchObject({ state: "error", detail: "ECONNREFUSED" });
  });

  test("a successful check after a failed pull shows only ready, and a failed check after it shows its message", async () => {
    let ok = true;
    const registry = [fake("flaky", { pull: async () => ({ kind: "failed", reason: "down" }), check: async () => (ok ? { ok: true, message: null } : { ok: false, message: "Umami refused the key (401). Paste a new key." }) })];
    await pullConnector("flaky", registry);
    expect(card(registry, "flaky")?.state).toBe("error");
    await checkConnector("flaky", registry);
    expect(card(registry, "flaky")).toEqual({ state: "ready", message: null, detail: null });
    ok = false;
    await checkConnector("flaky", registry);
    expect(card(registry, "flaky")).toEqual({ state: "error", message: "Umami refused the key (401). Paste a new key.", detail: null });
  });

  test("a connector missing setup is not connected, and its last check says why", async () => {
    const registry = [fake("needs-key", { pull: complete, secret: true }), fake("manifest-only", { adapter: false })];
    await checkConnector("manifest-only", registry);
    expect(card(registry, "needs-key")?.state).toBe("not-connected");
    expect(card(registry, "manifest-only")).toEqual({ state: "not-connected", message: "manifest-only is not connected", detail: null });
    await expect(pullConnector("needs-key", registry)).rejects.toThrow("needs-key is not set up");
  });

  test("only the Graph connector carries the hourly call budget", () => {
    const rows = getVaultBoard(new Date());
    expect(rows.find((r) => r.id === "instagram-graph")?.graphCallsLeft).toBe(200);
    expect(rows.filter((r) => r.graphCallsLeft !== null).map((r) => r.id)).toEqual(["instagram-graph"]);
  });
});
