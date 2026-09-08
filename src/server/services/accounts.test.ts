import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";

import {
  accountAvailable,
  accountChildEnv,
  addAccount,
  getDefaultAccount,
  type IgAccount,
  listAccounts,
  planAccountSync,
  removeAccount,
  resolveAccountForChannel,
  setAccountCooldown,
  setChannelAccount,
} from "./accounts";

let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

const NOW = Date.parse("2026-09-08T00:00:00.000Z");

function acct(over: Partial<IgAccount>): IgAccount {
  return {
    id: "a",
    label: "A",
    username: "a",
    isDefault: false,
    status: "active",
    proxy: null,
    deviceSeed: null,
    sessionPath: null,
    port: null,
    cooldownUntil: null,
    lastSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

// ---------------------------------------------------------------- pure scheduler

describe("accountAvailable", () => {
  test("active, no cooldown: available", () => {
    expect(accountAvailable(acct({}), NOW)).toBe(true);
  });
  test("paused: unavailable", () => {
    expect(accountAvailable(acct({ status: "paused" }), NOW)).toBe(false);
  });
  test("live cooldown: unavailable; expired cooldown: available", () => {
    expect(accountAvailable(acct({ cooldownUntil: new Date(NOW + 60_000).toISOString() }), NOW)).toBe(false);
    expect(accountAvailable(acct({ cooldownUntil: new Date(NOW - 60_000).toISOString() }), NOW)).toBe(true);
  });
});

describe("resolveAccountForChannel", () => {
  const def = acct({ id: "def", isDefault: true });
  const other = acct({ id: "other", isDefault: false });
  test("sticky assignment wins", () => {
    expect(resolveAccountForChannel({ accountId: "other" }, [def, other])?.id).toBe("other");
  });
  test("null assignment falls to default", () => {
    expect(resolveAccountForChannel({ accountId: null }, [def, other])?.id).toBe("def");
  });
  test("dangling assignment falls to default, never nothing", () => {
    expect(resolveAccountForChannel({ accountId: "gone" }, [def, other])?.id).toBe("def");
  });
});

describe("planAccountSync", () => {
  const def = acct({ id: "def", username: "def", isDefault: true, createdAt: "2026-01-01T00:00:00Z" });
  const b = acct({ id: "b", username: "b", createdAt: "2026-01-02T00:00:00Z" });

  test("groups channels by their sticky account", () => {
    const channels = [
      { id: "c1", accountId: null }, // -> def
      { id: "c2", accountId: "b" }, // -> b
      { id: "c3", accountId: "b" }, // -> b
    ];
    const plan = planAccountSync(channels, [def, b], NOW);
    expect(plan.groups).toHaveLength(2);
    const defGroup = plan.groups.find((g) => g.account.id === "def")!;
    const bGroup = plan.groups.find((g) => g.account.id === "b")!;
    expect(defGroup.channelIds).toEqual(["c1"]);
    expect(bGroup.channelIds).toEqual(["c2", "c3"]);
  });

  test("a cooled-down account is skipped while its siblings still run", () => {
    const cooling = acct({ id: "b", username: "b", cooldownUntil: new Date(NOW + 60_000).toISOString(), createdAt: "2026-01-02T00:00:00Z" });
    const channels = [
      { id: "c1", accountId: "def" },
      { id: "c2", accountId: "b" },
    ];
    const plan = planAccountSync(channels, [def, cooling], NOW);
    // def still runs...
    expect(plan.groups.map((g) => g.account.id)).toEqual(["def"]);
    // ...and b is surfaced as skipped, not dropped
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].account.id).toBe("b");
    expect(plan.skipped[0].reason).toBe("cooldown");
    expect(plan.skipped[0].channelIds).toEqual(["c2"]);
  });

  test("a paused account is skipped with reason 'paused'", () => {
    const paused = acct({ id: "b", username: "b", status: "paused", createdAt: "2026-01-02T00:00:00Z" });
    const plan = planAccountSync([{ id: "c2", accountId: "b" }], [def, paused], NOW);
    expect(plan.groups).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("paused");
  });

  test("groups are ordered by account age (deterministic)", () => {
    const plan = planAccountSync(
      [{ id: "c1", accountId: "b" }, { id: "c2", accountId: "def" }],
      [b, def],
      NOW,
    );
    expect(plan.groups.map((g) => g.account.id)).toEqual(["def", "b"]);
  });

  test("no default and an unresolvable channel is reported, not dropped", () => {
    const plan = planAccountSync([{ id: "c1", accountId: null }], [b], NOW);
    expect(plan.unassignedChannelIds).toEqual(["c1"]);
    expect(plan.groups).toHaveLength(0);
  });
});

describe("accountChildEnv", () => {
  test("isolates identity; only defined values included", () => {
    const env = accountChildEnv(acct({ username: "burner", proxy: "http://p", deviceSeed: "seed", port: 8766 }), "pw");
    expect(env).toEqual({ IG_USERNAME: "burner", IG_PASSWORD: "pw", IG_PROXY: "http://p", IG_DEVICE_SEED: "seed", IG_SERVICE_PORT: "8766" });
  });
  test("omits password when not provided", () => {
    const env = accountChildEnv(acct({ username: "burner" }), undefined);
    expect(env).toEqual({ IG_USERNAME: "burner" });
  });
});

// ---------------------------------------------------------------- db CRUD

describe("account CRUD", () => {
  test("first account is default, second is not, duplicate username rejected", async () => {
    const first = await addAccount({ label: "Burner A", username: "@burner_a", password: "pw" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.account.isDefault).toBe(true);
    expect(first.account.username).toBe("burner_a"); // @ stripped

    const second = await addAccount({ label: "Burner B", username: "burner_b" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.account.isDefault).toBe(false);

    const dup = await addAccount({ label: "dup", username: "burner_a" });
    expect(dup.ok).toBe(false);

    expect((await listAccounts()).length).toBeGreaterThanOrEqual(2);
    expect((await getDefaultAccount())?.username).toBe("burner_a");
  });

  test("cooldown on one account does not touch another", async () => {
    const a = await addAccount({ label: "Cool A", username: "cool_a" });
    const b = await addAccount({ label: "Cool B", username: "cool_b" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    await setAccountCooldown(a.account.id, new Date(NOW + 60_000).toISOString());
    const accounts = await listAccounts();
    const reloadedA = accounts.find((x) => x.id === a.account.id)!;
    const reloadedB = accounts.find((x) => x.id === b.account.id)!;
    expect(reloadedA.cooldownUntil).toBeTruthy();
    expect(reloadedB.cooldownUntil).toBeNull();
  });

  test("sticky channel assignment persists and unassigns on account removal", async () => {
    const { db, tables, newId, nowIso } = await import("@/server/db");
    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@acct-${channelId}`, trackedSince: nowIso() });
    const acc = await addAccount({ label: "Sticky", username: `sticky_${channelId.slice(0, 6)}` });
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;

    await setChannelAccount(channelId, acc.account.id);
    const [pinned] = await db.select().from(tables.channels).where(eq(tables.channels.id, channelId)).limit(1);
    expect(pinned.accountId).toBe(acc.account.id);

    await removeAccount(acc.account.id);
    const [after] = await db.select().from(tables.channels).where(eq(tables.channels.id, channelId)).limit(1);
    expect(after.accountId).toBeNull(); // ON DELETE SET NULL
  });
});
