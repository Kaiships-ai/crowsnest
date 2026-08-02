import { describe, expect, it } from "vitest";
import { evaluateSla } from "./sla";

const base = {
  status: "running",
  startedAt: new Date(0).toISOString(),
  heartbeatAt: new Date(0).toISOString(),
  budgetMs: 600000,
  staleMs: 90000,
};

describe("evaluateSla", () => {
  it("flags over budget", () => {
    const v = evaluateSla({ ...base, now: 700000 }); // 700s elapsed, budget 600s
    expect(v.overBudget).toBe(true);
    expect(v.breach).toBe(true);
  });

  it("flags stuck when heartbeat is stale", () => {
    const v = evaluateSla({ ...base, heartbeatAt: new Date(0).toISOString(), now: 100000 }); // 100s since heartbeat, stale 90s
    expect(v.stuck).toBe(true);
    expect(v.breach).toBe(true);
  });

  it("finished runs never breach", () => {
    const v = evaluateSla({ ...base, status: "success", now: 999999999 });
    expect(v.breach).toBe(false);
    expect(v.overBudget).toBe(false);
    expect(v.stuck).toBe(false);
  });

  it("is not over budget or stuck when well within limits", () => {
    const v = evaluateSla({ ...base, now: 1000 });
    expect(v.overBudget).toBe(false);
    expect(v.stuck).toBe(false);
    expect(v.breach).toBe(false);
  });

  it("does not flag stuck when heartbeatAt is null", () => {
    const v = evaluateSla({ ...base, heartbeatAt: null, now: 100000 });
    expect(v.stuck).toBe(false);
  });

  it("guards against unparseable startedAt", () => {
    const v = evaluateSla({ ...base, startedAt: "not-a-date", now: 700000 });
    expect(v.overBudget).toBe(false);
    expect(v.stuck).toBe(false);
    expect(v.breach).toBe(false);
  });

  it("guards against unparseable heartbeatAt", () => {
    const v = evaluateSla({ ...base, heartbeatAt: "not-a-date", now: 100000 });
    expect(v.stuck).toBe(false);
    expect(v.breach).toBe(false);
  });
});
