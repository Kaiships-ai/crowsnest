#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GUARDED = ["src/renderer/", "src/server/"];
export const FEATURES = ".claude/skills/verify/features/";
export const isFeatureFile = (f) => f.startsWith(FEATURES) && f.endsWith(".md") && f !== `${FEATURES}README.md`;

export function uncoveredFiles(files) {
  if (files.some(isFeatureFile)) return [];
  return files.filter((f) => GUARDED.some((g) => f.startsWith(g)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] ?? "origin/main";
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const uncovered = uncoveredFiles(files);
  if (uncovered.length) {
    console.log(
      `FAIL  ${uncovered.length} changed file(s) under ${GUARDED.join(" or ")} and no feature file (other than README.md) changed under ${FEATURES}. ` +
        "Add or update the feature's verify file and its app journey (G-03). First: " +
        uncovered.slice(0, 5).join(", "),
    );
    process.exit(1);
  }
  console.log(`OK    verify coverage: ${files.length} changed file(s) checked against ${base}`);
}
