import { beforeAll, describe, expect, test } from "vitest";

import { getArtifact, listArtifacts, saveArtifact } from "./artifacts";

let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

describe("saveArtifact", () => {
  test("creates an artifact and stamps provenance and timestamps", async () => {
    const r = await saveArtifact({
      kind: "angles",
      title: "Three angles for the fitness niche",
      data: { angles: ["contrarian", "beginner-mistake", "before-after"] },
      agent: "claude",
      model: "claude-opus-4-8",
      sourceVideoIds: ["v1", "v2"],
      assumptions: "niche is fitness",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBeTruthy();
    expect(r.artifact.agent).toBe("claude");
    expect(r.artifact.model).toBe("claude-opus-4-8");
    expect(r.artifact.sourceVideoIds).toEqual(["v1", "v2"]);
    expect(r.artifact.assumptions).toBe("niche is fitness");
    expect(r.artifact.createdAt).toBeTruthy();
    expect(r.artifact.updatedAt).toBe(r.artifact.createdAt);
    expect(r.artifact.data).toEqual({ angles: ["contrarian", "beginner-mistake", "before-after"] });
  });

  test("holds 100+ ideas in one idea_bank artifact (no per-video cap)", async () => {
    const ideas = Array.from({ length: 150 }, (_, i) => ({ concept: `c${i}`, angle: "a" }));
    const r = await saveArtifact({ kind: "idea_bank", title: "150 ideas", data: { ideas }, agent: "codex" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.artifact.data as { ideas: unknown[] }).ideas).toHaveLength(150);
  });

  test("updates in place when given an existing id, bumping updatedAt only", async () => {
    const created = await saveArtifact({ kind: "brief", title: "v1", data: { body: "one" }, agent: "claude" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await saveArtifact({ id: created.id, kind: "brief", title: "v2", data: { body: "two" }, agent: "claude" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.id).toBe(created.id);
    expect(updated.artifact.title).toBe("v2");
    expect(updated.artifact.data).toEqual({ body: "two" });
    expect(updated.artifact.createdAt).toBe(created.artifact.createdAt);
    // one row, not two
    const one = await getArtifact(created.id);
    expect(one?.title).toBe("v2");
  });

  test("rejects an unknown id on update", async () => {
    const r = await saveArtifact({ id: "nope", kind: "brief", title: "x", data: { a: 1 }, agent: "claude" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not found");
  });

  test("rejects an unknown kind, a missing title, a missing agent, and a missing payload", async () => {
    expect((await saveArtifact({ kind: "bogus", title: "t", data: {}, agent: "a" })).ok).toBe(false);
    expect((await saveArtifact({ kind: "angles", title: "", data: {}, agent: "a" })).ok).toBe(false);
    expect((await saveArtifact({ kind: "angles", title: "t", data: {}, agent: "" })).ok).toBe(false);
    expect((await saveArtifact({ kind: "angles", title: "t", agent: "a" })).ok).toBe(false);
  });
});

describe("listArtifacts", () => {
  test("filters by kind and returns newest first", async () => {
    const first = await saveArtifact({ kind: "monthly_plan", title: "plan A", data: { weeks: [] }, agent: "claude" });
    // ensure a distinct createdAt ordering
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveArtifact({ kind: "monthly_plan", title: "plan B", data: { weeks: [] }, agent: "claude" });
    expect(first.ok && second.ok).toBe(true);

    const listed = await listArtifacts({ kind: "monthly_plan" });
    expect(listed.items.every((i) => i.kind === "monthly_plan")).toBe(true);
    expect(listed.total).toBeGreaterThanOrEqual(2);
    // newest first
    const titles = listed.items.map((i) => i.title);
    expect(titles.indexOf("plan B")).toBeLessThan(titles.indexOf("plan A"));
  });

  test("paginates with limit and offset", async () => {
    const page1 = await listArtifacts({ kind: "monthly_plan", limit: 1, offset: 0 });
    const page2 = await listArtifacts({ kind: "monthly_plan", limit: 1, offset: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
  });
});
