#!/usr/bin/env node
// Fails when drizzle/*.sql and drizzle/meta/_journal.json disagree. Two PRs that each
// generate a migration against main both pick the next number; git keeps both SQL
// files but the journal merge keeps one entry, and drizzle silently never runs the
// other (7295f23).
import { readdirSync, readFileSync } from "node:fs";

const dir = process.argv[2] ?? "drizzle";
const tags = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4)).sort();
const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, "utf8")).entries.map((e) => e.tag);

const problems = [];
const byNumber = new Map();
for (const tag of tags) {
  const n = tag.split("_")[0];
  byNumber.set(n, [...(byNumber.get(n) ?? []), tag]);
}
for (const [n, same] of byNumber) {
  if (same.length > 1) problems.push(`two migrations share number ${n}: ${same.join(", ")}. Regenerate the newer one with npm run db:generate after merging main.`);
}
for (const tag of tags) {
  if (!journal.includes(tag)) problems.push(`${dir}/${tag}.sql is not in ${dir}/meta/_journal.json, so drizzle will never run it.`);
}
for (const tag of journal) {
  if (!tags.includes(tag)) problems.push(`${dir}/meta/_journal.json lists ${tag} but ${dir}/${tag}.sql does not exist.`);
}

if (problems.length) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  process.exit(1);
}
console.log(`OK    migrations: ${tags.length} files match the journal`);
