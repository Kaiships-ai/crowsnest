import { mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { checkVideoFile } from "./video-file";

const dir = mkdtempSync(path.join(os.tmpdir(), "crowsnest-video-file-"));
const fixture = path.join(__dirname, "__fixtures__", "tiny.mp4");

test("accepts a real mp4", async () => {
  expect(await checkVideoFile(fixture)).toEqual({ ok: true });
});

test("refuses a missing path", async () => {
  expect(await checkVideoFile(path.join(dir, "nope.mp4"))).toMatchObject({ ok: false, code: "PLAN_FILE_MISSING" });
});

test("refuses a file with no ftyp box", async () => {
  const fake = path.join(dir, "fake.mp4");
  writeFileSync(fake, "this is a text file renamed to mp4");
  expect(await checkVideoFile(fake)).toMatchObject({ ok: false, code: "PLAN_NOT_MP4" });
});

test("refuses a file over 200 MB", async () => {
  const big = path.join(dir, "big.mp4");
  writeFileSync(big, "");
  truncateSync(big, 200 * 1024 * 1024 + 1);
  expect(await checkVideoFile(big)).toMatchObject({ ok: false, code: "PLAN_FILE_TOO_LARGE" });
});
