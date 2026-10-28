import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { changeFallback, feedbackMessage, readCookIndex, recordCookRound, snapshotCookVersion } from "./cook-versions";

const film = (): string => {
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "cook-v-")), "films", "reel");
  mkdirSync(path.join(dir, "vo"), { recursive: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/a.js"), "a");
  return dir;
};
const deliver = (dir: string, hook: string, hookSec: number, at: number) => {
  writeFileSync(path.join(dir, "reel.mp4"), "not an mp4");
  utimesSync(path.join(dir, "reel.mp4"), at, at);
  writeFileSync(path.join(dir, "vo/script.json"), JSON.stringify({ lines: [{ text: hook }, { text: "Two." }] }));
  writeFileSync(path.join(dir, "vo/vo.json"), JSON.stringify({ lines: [{ s: 0, e: hookSec }] }));
};
const JOB = { outputs: ["out/verify/draft.mp4", "reel.mp4"], qa: "12/12" };

test("deliver saves one version per final, keeps its files, and the next one gets a fallback change", async () => {
  const dir = film();
  deliver(dir, "Hook one.", 2.6, 1000);
  await Promise.all([snapshotCookVersion(dir, JOB), snapshotCookVersion(dir, JOB)]);
  await snapshotCookVersion(dir, JOB);
  expect((await readCookIndex(dir)).versions.map((v) => v.n)).toEqual([1]);
  expect(readFileSync(path.join(dir, "versions/v1/src/a.js"), "utf8")).toBe("a");
  expect(readFileSync(path.join(dir, "versions/v1/vo/script.json"), "utf8")).toContain("Hook one.");

  const round = await recordCookRound(dir, "  make the hook\nfaster ");
  expect(round?.message).toBe(feedbackMessage(1, 1, "make the hook faster"));
  expect(round?.message).toContain('v1 is kept in versions/v1/. Note: "make the hook faster".');

  deliver(dir, "Hook 1.", 2.1, 2000);
  const index = await snapshotCookVersion(dir, JOB);
  expect(index.versions.map((v) => [v.n, v.change])).toEqual([[1, null], [2, "hook 2.6 s → 2.1 s · 1 script line"]]);
  // A `change` already used by the last version is stale; a new one wins.
  deliver(dir, "Hook 1.", 2.1, 3000);
  expect((await snapshotCookVersion(dir, { ...JOB, change: "CTA slower" })).versions.at(-1)?.change).toBe("CTA slower");
});

test("the fallback change names only what differs", () => {
  const base = { hookSec: 2.6, durationSec: 41, scriptLines: ["a", "b"] };
  expect(changeFallback(base, { ...base, durationSec: 40.2 })).toBe("length 0:41 → 0:40");
  expect(changeFallback(base, { ...base, scriptLines: ["a", "b", "c"] })).toBe("1 script line");
  expect(changeFallback(base, base)).toBeNull();
});
