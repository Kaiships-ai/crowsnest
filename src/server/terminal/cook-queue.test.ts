import { describe, expect, it } from "vitest";
import { runOnCookQueue } from "./cook-queue";

describe("runOnCookQueue", () => {
  it("runs a job and returns its value", async () => {
    await expect(runOnCookQueue(async () => 41 + 1)).resolves.toBe(42);
  });

  it("does not run more than the concurrency limit at once", async () => {
    let active = 0;
    let peak = 0;
    const job = () =>
      runOnCookQueue(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      });
    await Promise.all([job(), job(), job(), job()]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
