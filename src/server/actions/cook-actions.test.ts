import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { clearPlanCookingAction, cookPlanCardAction, cookRoot, markPlanCookingAction } from "./cook-actions";

const T = "2026-10-01T00:00:00.000Z";
const tomorrow = () => new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE");
const plan = (id: string, fields: Partial<typeof tables.plannedPosts.$inferInsert> = {}) => ({ id, title: "Hook A", state: "draft", plannedDate: tomorrow(), scriptId: "s1", createdAt: T, updatedAt: T, ...fields });
const env = { ...process.env };
let root: string;

beforeEach(async () => {
  migrate();
  root = mkdtempSync(path.join(os.tmpdir(), "cook-"));
  process.env.LEAD_STUDIO_COOK_ROOT = root;
  for (const t of [tables.plannedPosts, tables.scripts]) await db.delete(t);
  await db.insert(tables.scripts).values({ id: "s1", title: "Hook", content: "Line one.", createdAt: T, updatedAt: T });
});
afterEach(() => {
  process.env = { ...env };
});

test("a verify lane without its own studio-reel copy never falls back to the real checkout", async () => {
  delete process.env.LEAD_STUDIO_COOK_ROOT;
  process.env.ORCA_E2E_USER_DATA_DIR = "/tmp/lane";
  expect(cookRoot()).toBeNull();
  await db.insert(tables.plannedPosts).values(plan("p1"));
  expect(await cookPlanCardAction("p1")).toMatchObject({ ok: false, code: "COOK_NO_STUDIO" });
});

test("two reels with the same title get their own script file", async () => {
  await db.insert(tables.plannedPosts).values([plan("plan-aaaaaa"), plan("plan-bbbbbb", { title: "hook-a" })]);
  const a = await cookPlanCardAction("plan-aaaaaa");
  const b = await cookPlanCardAction("plan-bbbbbb");
  expect([a.ok && a.scriptPath, b.ok && b.scriptPath]).toEqual(["workspace/scripts/hook-a-aaaaaa.md", "workspace/scripts/hook-a-bbbbbb.md"]);
  expect(readdirSync(path.join(root, "workspace/scripts")).sort()).toEqual(["hook-a-aaaaaa.md", "hook-a-bbbbbb.md"]);
});

test("a reel already cooking, or armed with Instagram, is refused; a rolled-back Cook can retry", async () => {
  await db.insert(tables.plannedPosts).values([plan("p1"), plan("armed", { state: "scheduled", scheduledAt: "2099-01-01T00:00:00.000Z" })]);
  expect(await cookPlanCardAction("armed")).toMatchObject({ ok: false, code: "COOK_LOCKED" });
  expect(await markPlanCookingAction("p1", "ws1")).toEqual({ ok: true });
  expect(await markPlanCookingAction("p1", "ws2")).toMatchObject({ ok: false, code: "COOK_ALREADY" });
  expect(await cookPlanCardAction("p1")).toMatchObject({ ok: false, code: "COOK_ALREADY" });
  await clearPlanCookingAction("p1", "ws1");
  expect(await cookPlanCardAction("p1")).toMatchObject({ ok: true });
});
