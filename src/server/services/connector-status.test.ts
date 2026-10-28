import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionCheck, Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { SyncAlreadyRunningError } from "@/server/ig/errors";
import type { PullResult } from "@/server/lib/pull-result";
import { startSyncAction } from "@/server/actions/sync-actions";
import { cardStatus, checkConnector, pullConnector, readStatuses } from "./connector-status";

vi.mock("@/server/services/sync-engine", async (real) => ({
  ...(await real<object>()),
  runSync: vi.fn(async (opts: { onJobStarted?: (id: string) => void }) => {
    opts.onJobStarted?.("job-1");
    return { jobId: "job-1", gaps: [] };
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
