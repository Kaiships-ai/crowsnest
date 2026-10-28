import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionCheck, Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { SyncAlreadyRunningError } from "@/server/ig/errors";
import type { PullResult } from "@/server/lib/pull-result";
import { startSyncAction } from "@/server/actions/sync-actions";
import { runSync } from "@/server/services/sync-engine";
import { cardStatus, checkConnector, parseSummary, pullConnector, readStatuses, recordPullProgress, recordPullStart } from "./connector-status";

vi.mock("@/server/services/sync-engine", async (real) => ({
  ...(await real<object>()),
  runSync: vi.fn(async (opts: { onJobStarted?: (id: string) => void }) => {
    opts.onJobStarted?.("job-1");
    return { jobId: "job-1", gaps: [], handles: [], dispatched: 0 };
  }),
}));

type Pull = () => Promise<PullResult<unknown, unknown>>;

function fake(id: string, pull: Pull, check: () => Promise<ConnectionCheck>): Connector {
  return { manifest: { id, label: id, auth: "api-key", secrets: [], feeds: [] }, adapter: { testConnection: check, pull } };
}

const card = (id: string) => cardStatus(readStatuses().get(id));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  migrate();
  await db.delete(tables.connectorStatus);
});

describe("connector status", () => {
  test("a pull error then a passing check is still the pull's error", async () => {
    const registry = [fake("x", async () => ({ kind: "failed", reason: "sidecar down" }), async () => ({ ok: true, message: null }))];
    await pullConnector("x", registry);
    await checkConnector("x", registry);
    expect(card("x")).toEqual({ state: "error", message: "The last pull failed, so the older numbers stay. Re-check the key.", detail: "sidecar down" });
  });

  test("a partial, then a failed check, then a passing check is partial again", async () => {
    let ok = false;
    const registry = [fake("x", async () => ({ kind: "partial", rows: null, missing: "page 2", reason: "rate limited" }), async () => (ok ? { ok: true, message: null } : { ok: false, message: "Umami refused the key (401). Paste a new key." }))];
    await pullConnector("x", registry);
    await checkConnector("x", registry);
    expect(card("x")).toEqual({ state: "error", message: "Umami refused the key (401). Paste a new key.", detail: null });
    ok = true;
    await checkConnector("x", registry);
    expect(card("x")).toEqual({ state: "partial", message: "The last pull did not finish, so some numbers are older.", detail: "missing page 2: rate limited" });
  });

  test("a failed check, then a complete pull, is ready: the pull proved the key", async () => {
    const registry = [fake("x", async () => ({ kind: "complete", rows: null }), async () => ({ ok: false, message: "Umami refused the key (401). Paste a new key." }))];
    await checkConnector("x", registry);
    expect(card("x")).toEqual({ state: "error", message: "Umami refused the key (401). Paste a new key.", detail: null });
    await pullConnector("x", registry);
    expect(card("x")).toEqual({ state: "ready", message: null, detail: null });
    expect(readStatuses().get("x")?.checkMessage).toBeNull();
  });

  test("a sync scoped to some channels does not change the row; a full sync does", async () => {
    await startSyncAction(["channel-1"]);
    await flush();
    expect(readStatuses().has("ig-sidecar")).toBe(false);
    await startSyncAction();
    await flush();
    expect(readStatuses().get("ig-sidecar")?.pullState).toBe("error");
  });

  test("a pull that loses to a running sync rejects and records nothing", async () => {
    const registry = [fake("x", async () => {
      throw new SyncAlreadyRunningError(null);
    }, async () => ({ ok: true, message: null }))];
    await expect(pullConnector("x", registry)).rejects.toThrow("A sync is already running");
    expect(readStatuses().size).toBe(0);
  });
});

describe("a pulling row that lost its pull", () => {
  test("a pull this process did not start (the app quit mid-pull) reads as Partial with its done count", async () => {
    await db.insert(tables.connectorStatus).values({
      connectorId: "ig-sidecar",
      pullState: "pulling",
      updatedAt: new Date().toISOString(),
      startedAt: "2026-10-28T09:00:00.000Z",
      pulledAt: "2026-10-27T20:55:00.000Z",
      progressDone: 4,
      progressTotal: 15,
      progressLabel: "@sahilbloom",
    });
    const row = readStatuses().get("ig-sidecar");
    expect(cardStatus(row)).toEqual({ state: "partial", message: "The pull stopped at 4/15 before it finished. 4 have new numbers; the rest keep their older numbers.", detail: null });
    expect(parseSummary(row?.summary ?? null).pull).toMatchObject({ done: 4, total: 15, updated: 4, stop: "interrupted", olderFrom: "2026-10-27T20:55:00.000Z" });
  });

  test("a live pull reads as Pulling until its heartbeat is 10 minutes old, then as Partial", () => {
    recordPullStart("ig-sidecar");
    recordPullProgress("ig-sidecar", { done: 6, total: 15, label: "@garyvee" });
    const fresh = readStatuses().get("ig-sidecar");
    expect([cardStatus(fresh).state, fresh?.progressDone, fresh?.progressTotal, fresh?.progressLabel]).toEqual(["pulling", 6, 15, "@garyvee"]);

    const stale = readStatuses(new Date(Date.now() + 11 * 60_000)).get("ig-sidecar");
    expect(cardStatus(stale)).toEqual({ state: "partial", message: "The pull stopped at 6/15 before it finished. 6 have new numbers; the rest keep their older numbers.", detail: null });
  });
});

describe("Pull the rest on the sidecar card", () => {
  const result = (handles: string[], dispatched: number, synced: number, created: number, cancelled: boolean) => ({
    jobId: "job-1", handles, dispatched, channelsSynced: synced, itemsCreated: created, gaps: [], stopReason: cancelled ? "cancelled" : null,
  });
  const pullAt = async (at: string, opts: { rest?: true } | undefined, r: ReturnType<typeof result>) => {
    vi.setSystemTime(new Date(at));
    // SAFETY: the test reads only the fields syncSummary reads.
    vi.mocked(runSync).mockImplementationOnce(async (o) => {
      o?.onJobStarted?.("job-1");
      return r as unknown as Awaited<ReturnType<typeof runSync>>;
    });
    await startSyncAction(undefined, opts);
    await flush();
  };

  test("two stops in a row: the third pull skips everything since the first pull started, and counts the whole chain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(runSync).mockClear();
    await pullAt("2026-10-28T10:00:00.000Z", undefined, result(["a", "b", "c", "d"], 1, 1, 3, true));
    await pullAt("2026-10-28T10:05:00.000Z", { rest: true }, result(["b", "c", "d"], 2, 2, 1, true));
    await pullAt("2026-10-28T10:10:00.000Z", { rest: true }, result(["d"], 1, 1, 0, false));
    vi.useRealTimers();
    expect(vi.mocked(runSync).mock.calls.map(([o]) => o?.skipSyncedSince)).toEqual([undefined, "2026-10-28T10:00:00.000Z", "2026-10-28T10:00:00.000Z"]);
    expect(parseSummary(readStatuses().get("ig-sidecar")?.summary ?? null).pull).toMatchObject({
      total: 4, done: 4, updated: 4, newItems: 4, stop: null, startedAt: "2026-10-28T10:10:00.000Z", chainFrom: "2026-10-28T10:00:00.000Z",
    });
  });

  test("a fresh pull after a chain starts a new chain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await pullAt("2026-10-28T10:00:00.000Z", undefined, result(["a", "b"], 1, 1, 0, true));
    await pullAt("2026-10-28T10:05:00.000Z", undefined, result(["a", "b"], 1, 1, 0, true));
    vi.useRealTimers();
    expect(parseSummary(readStatuses().get("ig-sidecar")?.summary ?? null).pull).toMatchObject({ total: 2, updated: 1, chainFrom: "2026-10-28T10:05:00.000Z" });
  });
});
