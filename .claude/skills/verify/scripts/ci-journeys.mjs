#!/usr/bin/env node
// ci-journeys.mjs [base] -- the journeys verify.yml runs for a PR: each journey a changed feature file names
// (`app-drive.sh <journey>`) that runs on the boards lane, or shell-01 when there is none.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isFeatureFile } from "../../../../scripts/check-verify-coverage.mjs";

// Journeys that need their own lane script (stopped clock, fake Graph, a restart); run-all.sh runs them.
const OWN_LANE = /^(baseline-v2|gate2-01|schedule-01|fresh-01|card-state-\d+|graph-pull-01|crash-rest-.*)$/;
const JOURNEYS = ".claude/skills/verify/scripts/app-journeys";

const base = process.argv[2] ?? "origin/main";
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n");
const picked = new Set();
for (const f of changed.filter(isFeatureFile)) {
  if (!existsSync(f)) continue;
  for (const [, j] of readFileSync(f, "utf8").matchAll(/app-drive\.sh ([a-z0-9-]+)/g)) {
    if (!OWN_LANE.test(j) && existsSync(`${JOURNEYS}/${j}.mjs`)) picked.add(j);
  }
}
console.log([...(picked.size ? picked : ["shell-01"])].join(" "));
