import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";

let db: typeof import("./index")["db"];
let tables: typeof import("./index")["tables"];
let newId: typeof import("./index")["newId"];
let nowIso: typeof import("./index")["nowIso"];
let migrate: typeof import("./test-migrate")["migrate"];

/**
 * drizzle-orm's migrator (drizzle-orm/sqlite-core/dialect.ts, SQLiteSyncDialect#migrate)
 * is strictly forward-only: it tracks the newest-applied migration's timestamp in
 * `__drizzle_migrations` and only runs files newer than that. Once 0011 has been applied
 * on a connection, a later `migrate()` call on that SAME connection is a no-op for it --
 * confirmed empirically (a bare second `migrate()` call here left 2 rows, not 1, with no
 * error). Re-running the whole file isn't an option either: `ALTER TABLE ... ADD COLUMN`
 * has no `IF NOT EXISTS` in this SQLite build (confirmed: "near EXISTS: syntax error"),
 * so replaying the generated ALTER a second time would crash on "duplicate column name".
 *
 * So "prove the collapse SQL is idempotent" is verified here by replaying the backfill +
 * collapse statements straight out of the committed 0011 migration file (skipping its
 * first, schema-only statement) against the live connection, instead of re-invoking
 * `migrate()`. This exercises the actual committed SQL with no drift risk, in the one way
 * that's mechanically possible against a forward-only migrator on a shared connection.
 */
function replayCollapseSql() {
  const file = readFileSync(
    path.join(__dirname, "../../../drizzle/0011_dapper_scrambler.sql"),
    "utf8",
  );
  const [, ...dataStatements] = file.split("--> statement-breakpoint");
  db.$client.exec(dataStatements.join(";\n"));
}

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("./index"));
  ({ migrate } = await import("./test-migrate"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.channels);
});

describe("0011 sort_order + single-membership collapse", () => {
  test("fleets carry a sort_order column defaulting to 0", async () => {
    const id = newId();
    await db.insert(tables.fleets).values({ id, name: "A", createdAt: nowIso() });
    const [row] = await db.select().from(tables.fleets).where(eq(tables.fleets.id, id));
    expect(row.sortOrder).toBe(0);
  });

  test("a channel in two fleets is collapsed to one row on migrate", async () => {
    // Seed a multi-membership row set by hand, then replay the migration's collapse SQL
    // (see replayCollapseSql above for why this isn't a second migrate() call) to prove
    // it is idempotent and leaves exactly one membership.
    const chId = newId();
    const fA = newId(), fB = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@x", trackedSince: nowIso() });
    await db.insert(tables.fleets).values([
      { id: fA, name: "A", createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 0 },
      { id: fB, name: "B", createdAt: "2026-01-02T00:00:00.000Z", sortOrder: 1 },
    ]);
    await db.insert(tables.fleetChannels).values([
      { fleetId: fA, channelId: chId },
      { fleetId: fB, channelId: chId },
    ]);

    replayCollapseSql();

    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, chId));
    expect(rows).toHaveLength(1);
    // Keeps the lowest sort_order fleet (A).
    expect(rows[0].fleetId).toBe(fA);
  });
});
