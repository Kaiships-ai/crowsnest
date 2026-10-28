import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { clearPlanCookingAction, cookPlanCardAction, cookRoot, getCookView, markPlanCookingAction } from "./cook-actions";

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

test("the script's front matter names the keyword as campaign, so job.json's campaign is set", async () => {
  await db.insert(tables.plannedPosts).values(plan("plan-cccccc", { keyword: "HOOKS" }));
  const cooked = await cookPlanCardAction("plan-cccccc");
  expect(cooked.ok && readFileSync(path.join(root, cooked.scriptPath), "utf8")).toContain("\ncta_keyword: HOOKS\ncampaign: HOOKS\n");
});

const writeJob = (slug: string, steps: object[]) => {
  mkdirSync(path.join(root, "films", slug), { recursive: true });
  writeFileSync(path.join(root, "films", slug, "job.json"), JSON.stringify({ slug, steps, outputs: [] }));
};
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

test("the Cook view reads job.json: elapsed from started, a dead pid, and the usual render from the last renders", async () => {
  await db.insert(tables.plannedPosts).values(plan("plan-dddddd", { cookWorkspaceId: "ws1" }));
  expect(await getCookView("plan-dddddd")).toMatchObject({ ok: true, slug: "hook-a-dddddd", cooking: true, steps: null, usualRenderSec: 180 });
  writeJob("hook-a-dddddd", [{ name: "render", status: "running", started: ago(90), pid: 2 ** 22 + 7 }]);
  expect(await getCookView("plan-dddddd")).toMatchObject({ elapsedSec: 90, pidGone: true, usualRenderSec: 180 });
  for (const [i, sec] of [60, 120, 300].entries()) writeJob(`old-${i}`, [{ name: "render", status: "done", started: ago(1000 + sec), ended: ago(1000) }]);
  expect(await getCookView("plan-dddddd")).toMatchObject({ usualRenderSec: 120 });
});
