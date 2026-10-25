#!/usr/bin/env node
// Fails when a change touches studio/src/renderer/ or src/server/ without touching a verify
// feature in .claude/skills/verify/features/. Rule G-03: every PR that adds or changes a
// feature updates its verify feature and the journey that runs it on the Lead Studio app.
//   node scripts/check-verify-coverage.mjs <base-ref>    diff <base-ref>...HEAD
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GUARDED = ["studio/src/renderer/", "src/server/"];
const FEATURES = ".claude/skills/verify/features/";

export function uncoveredFiles(files) {
  if (files.some((f) => f.startsWith(FEATURES))) return [];
  return files.filter((f) => GUARDED.some((g) => f.startsWith(g)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  if (!base) {
    console.log("usage: node scripts/check-verify-coverage.mjs <base-ref>");
    process.exit(2);
  }
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const uncovered = uncoveredFiles(files);
  if (uncovered.length) {
    console.log(
      `FAIL  ${uncovered.length} changed file(s) under ${GUARDED.join(" or ")} and no change under ${FEATURES}. ` +
        "Add or update the feature's verify file and its app journey (G-03). First: " +
        uncovered.slice(0, 5).join(", "),
    );
    process.exit(1);
  }
  console.log(`OK    verify coverage: ${files.length} changed file(s) checked against ${base}`);
}
