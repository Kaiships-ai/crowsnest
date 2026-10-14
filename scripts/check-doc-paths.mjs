#!/usr/bin/env node
// Fails when live docs or agent instructions cite a repo file in backticks that does
// not exist. Deletes and moves keep leaving dead citations behind (PR #100 cited the
// old evidence/ path; skills cited references/ files of deleted skills).
// A citation resolves if it exists as written, relative to the citing file, or as the
// tail of a tracked path (docs abbreviate `ig/client.ts`).
// Citations that were already dead live in scripts/doc-paths.baseline; only new ones
// fail. Fix a baseline entry and the check tells you to drop its line.
//   node scripts/check-doc-paths.mjs            check
//   node scripts/check-doc-paths.mjs --write    rewrite the baseline (needs review)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BASELINE = "scripts/doc-paths.baseline";
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const docs = tracked.filter(
  (f) =>
    f.endsWith(".md") &&
    (f.startsWith("documents/") || f.startsWith(".claude/skills/") || ["AGENTS.md", "CLAUDE.md", "README.md"].includes(f)) &&
    !f.startsWith("documents/archive/") &&
    !f.startsWith("documents/planning/"),
);
const citation = /`([\w.()[\]/-]+\/[\w.()[\]-]+\.(?:ts|tsx|mjs|cjs|js|sh|md|json|sql|py|ya?ml|toml))(?::\d+(?:-\d+)?)?`/g;

const resolves = (doc, p) =>
  existsSync(p) || existsSync(join(dirname(doc), p)) || tracked.some((t) => t.endsWith(`/${p}`));

const dead = new Set();
for (const doc of docs) {
  for (const [, p] of readFileSync(doc, "utf8").matchAll(citation)) {
    if (!resolves(doc, p)) dead.add(`${doc}\t${p}`);
  }
}

if (process.argv.includes("--write")) {
  writeFileSync(BASELINE, [...dead].sort().join("\n") + "\n");
  console.log(`wrote ${dead.size} entries to ${BASELINE}`);
  process.exit(0);
}

const baseline = new Set(readFileSync(BASELINE, "utf8").split("\n").filter(Boolean));
const added = [...dead].filter((d) => !baseline.has(d)).sort();
const fixed = [...baseline].filter((b) => !dead.has(b)).sort();
for (const d of added) {
  const [doc, p] = d.split("\t");
  console.log(`FAIL  ${doc} cites \`${p}\`, which no tracked file matches. Point it at the file's current path or drop the citation.`);
}
for (const b of fixed) {
  const [doc, p] = b.split("\t");
  console.log(`FAIL  ${doc} no longer has a dead \`${p}\`. Delete that line from ${BASELINE}.`);
}
if (added.length || fixed.length) process.exit(1);
console.log(`OK    doc paths: no new dead citations (${baseline.size} known in ${BASELINE})`);
