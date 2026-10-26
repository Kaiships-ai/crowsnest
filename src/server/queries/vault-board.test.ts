import { beforeEach, describe, expect, test } from "vitest";
import type { Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import type { PullResult } from "@/server/lib/pull-result";
import { pullAgain, runDailyPull } from "@/server/services/daily-pull";
import { getVaultBoard, nextPullAt } from "./vault-board";

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

function fake(id: string, opts: { pull?: () => Promise<PullResult<unknown, unknown>>; adapter?: boolean; secret?: boolean } = {}): Connector {
  const testConnection = async () => ({ ok: true, message: null });
  const adapter = opts.adapter === false ? null : opts.pull ? { testConnection, pull: opts.pull } : { testConnection };
  const secrets = opts.secret ? [{ name: `VAULT_TEST_${id.toUpperCase()}`, label: "API key" }] : [];
  return { manifest: { id, label: id, auth: "api-key", secrets, feeds: [] }, adapter };
}

const complete = async () => ({ kind: "complete" as const, rows: null });
const stateById = (rows: ReturnType<typeof getVaultBoard>) => Object.fromEntries(rows.map((r) => [r.id, r.state]));

beforeEach(async () => {
  migrate();
  await db.delete(tables.dailyPulls);
});

describe("nextPullAt", () => {
  test("is today's 05:00 before it, tomorrow's from it on", () => {
    expect(nextPullAt(at(27, 4, 59))).toEqual(at(27, 5));
    expect(nextPullAt(at(27, 5))).toEqual(at(28, 5));
  });
});

describe("getVaultBoard", () => {
  test("maps each connector's status and last pull to one state", async () => {
    const registry = [
      fake("manifest-only", { adapter: false }),
      fake("needs-key", { pull: complete, secret: true }),
      fake("no-pull"),
      fake("never-pulled", { pull: complete }),
      fake("ok", { pull: complete }),
      fake("partial", { pull: async () => ({ kind: "partial", rows: null, missing: "page 2", reason: "rate limited" }) }),
      fake("broken", { pull: async () => ({ kind: "failed", reason: "sidecar down" }) }),
    ];
    await runDailyPull(at(27, 6), registry.filter((c) => c.manifest.id !== "never-pulled"));
    const rows = getVaultBoard(at(27, 9), registry);
    expect(stateById(rows)).toEqual({
      "manifest-only": "not-connected",
      "needs-key": "not-connected",
      "no-pull": "running",
      "never-pulled": "stale",
      ok: "running",
      partial: "partial",
      broken: "error",
    });
    expect(rows.find((r) => r.id === "needs-key")?.missingSecretLabels).toEqual(["API key"]);
    expect(rows.find((r) => r.id === "broken")?.lastPull).toMatchObject({ outcome: "failed", detail: "sidecar down" });
    expect(rows.find((r) => r.id === "partial")?.lastPull?.detail).toBe("missing page 2: rate limited");
  });

  test("a complete pull from an earlier slot is stale", async () => {
    const registry = [fake("ok", { pull: complete })];
    await runDailyPull(at(26, 6), registry);
    expect(stateById(getVaultBoard(at(27, 6), registry))).toEqual({ ok: "stale" });
  });

  test("a newer pull-again wins over the slot row", async () => {
    let fail = true;
    const registry = [fake("flaky", { pull: async () => (fail ? { kind: "failed", reason: "down" } : { kind: "complete", rows: null }) })];
    await runDailyPull(new Date(Date.now() - 60_000), registry);
    expect(stateById(getVaultBoard(new Date(), registry))).toEqual({ flaky: "error" });
    fail = false;
    await pullAgain("flaky", registry);
    expect(stateById(getVaultBoard(new Date(), registry))).toEqual({ flaky: "running" });
  });

  test("only the Graph connector carries the hourly call budget", () => {
    const rows = getVaultBoard(at(27, 9));
    expect(rows.find((r) => r.id === "instagram-graph")?.graphCallsLeft).toBe(200);
    expect(rows.filter((r) => r.graphCallsLeft !== null).map((r) => r.id)).toEqual(["instagram-graph"]);
  });
});
