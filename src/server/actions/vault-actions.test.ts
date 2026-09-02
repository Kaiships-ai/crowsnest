import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let createVaultItemAction: typeof import("./vault-actions")["createVaultItemAction"];
let saveToVaultAction: typeof import("./vault-actions")["saveToVaultAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ createVaultItemAction, saveToVaultAction } = await import("./vault-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.vaultItems);
});

const hookInput = { type: "hook" as const, title: "Curiosity Gap Hook", templateText: "the {topic} nobody talks about", tags: ["curiosity"] };
const styleInput = { type: "style" as const, title: "Fast-Cut Listicle", templateText: "5 beats, CTA at end", tags: ["editing"] };

describe("saveToVaultAction (B-05: Save to Vault 'both' half-write / retry duplicate)", () => {
  test("a failure on the second item rolls back the first too — no half-write left behind", async () => {
    // Same shape as the dialog's "both" write, but the style item is malformed (a
    // simulated write failure — templateText is NOT NULL) so its insert throws partway
    // through the batch, after the hook item would already have been written.
    const brokenStyle = { ...styleInput, templateText: null as unknown as string };

    const result = await saveToVaultAction({ items: [hookInput, brokenStyle] });
    expect(result.ok).toBe(false);

    // Before the fix, the hook item was committed independently of the style item (two
    // separate createVaultItemAction calls, no shared transaction) — a half-write. With
    // the batch wrapped in one db.transaction, the failed style insert rolls the hook
    // insert back with it: nothing lands at all.
    const rows = await db.select().from(tables.vaultItems);
    expect(rows).toHaveLength(0);
  });

  test("retrying after a fixed failure succeeds without duplicating whatever had landed on the failed attempt", async () => {
    const brokenStyle = { ...styleInput, templateText: null as unknown as string };
    const failed = await saveToVaultAction({ items: [hookInput, brokenStyle] });
    expect(failed.ok).toBe(false);

    // Retry with corrected content (what "Save" does the second time, e.g. after the
    // user fixes the field the error pointed at, or a plain resubmit).
    const retried = await saveToVaultAction({ items: [hookInput, styleInput] });
    expect(retried.ok).toBe(true);

    // Exactly one hook and one style row — not two hooks (which a retry-duplicates-the-
    // landed-row bug would produce if the first attempt's hook had survived the rollback).
    const rows = await db.select({ type: tables.vaultItems.type, title: tables.vaultItems.title }).from(tables.vaultItems);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.type === "hook")).toHaveLength(1);
    expect(rows.filter((r) => r.type === "style")).toHaveLength(1);
  });

  test("retrying a fully successful save with unchanged content is a no-op, not a duplicate", async () => {
    const first = await saveToVaultAction({ items: [hookInput, styleInput] });
    expect(first.ok).toBe(true);

    // A network resend / accidental double-click resubmits the exact same form values.
    const second = await saveToVaultAction({ items: [hookInput, styleInput] });
    expect(second.ok).toBe(true);

    const rows = await db.select().from(tables.vaultItems);
    expect(rows).toHaveLength(2);
  });
});

describe("createVaultItemAction idempotency (shared with saveToVaultAction)", () => {
  test("calling twice with identical input reuses the existing row instead of duplicating it", async () => {
    const first = await createVaultItemAction(hookInput);
    expect(first.ok).toBe(true);
    const second = await createVaultItemAction(hookInput);
    expect(second.ok).toBe(true);

    const rows = await db.select().from(tables.vaultItems);
    expect(rows).toHaveLength(1);
  });

  test("a genuinely edited resubmission (different template text) is a new item, not a dedup", async () => {
    await createVaultItemAction(hookInput);
    await createVaultItemAction({ ...hookInput, templateText: "a different template entirely" });

    const rows = await db.select().from(tables.vaultItems);
    expect(rows).toHaveLength(2);
  });
});
