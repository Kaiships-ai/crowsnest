// run-all-report.mjs <evidence-dir> -- one HTML page from a run-all.sh run: each DoD id with its
// pass criterion and the journeys that check it, then each journey's steps, DB checks, shots and diffs.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2]);
const journeysDir = path.join(import.meta.dirname, "app-journeys");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The DoD table lives in the main checkout's handoff folder (gitignored); without it the report lists ids only.
const main = path.dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
const dodFile = process.env.DOD_DATA ?? path.join(main, "data/handoff/ui-ux-refactor/lead-studio/proposal/data.js");
const dodTable = existsSync(dodFile)
  ? new Function(`${readFileSync(dodFile, "utf8").match(/const DOD = \[[\s\S]*?\n\];/)[0]} return DOD;`)()
  : [];

const journeys = readdirSync(out)
  .filter((f) => f.endsWith(".rc"))
  .map((f) => f.slice(0, -3))
  .sort()
  .map((name) => {
    const source = existsSync(path.join(journeysDir, `${name}.mjs`)) ? readFileSync(path.join(journeysDir, `${name}.mjs`), "utf8") : "";
    const dod = [...(source.match(/export const dod = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const lines = readFileSync(path.join(out, `${name}.out`), "utf8").split("\n").filter(Boolean);
    return { name, dod, passed: readFileSync(path.join(out, `${name}.rc`), "utf8").trim() === "0", lines };
  });

const ids = [...new Set([...dodTable.map((r) => r[0]), ...journeys.flatMap((j) => j.dod)])];
const dodRows = ids.map((id) => {
  const row = dodTable.find((r) => r[0] === id);
  const by = journeys.filter((j) => j.dod.includes(id));
  const state = by.length === 0 ? "none" : by.every((j) => j.passed) ? "pass" : "fail";
  return { id, criterion: row ? row[3] : "", by, state };
});
const count = (s) => dodRows.filter((r) => r.state === s).length;

const lineClass = (l) => (/^FAIL|^app-drive:/.test(l) ? "fail" : /^ok:/.test(l) ? "ok" : /^snap:|^journey:/.test(l) ? "meta" : "log");
const shot = (l) => {
  const rel = l.match(/^snap: data\/verify\/evidence\/[^/]+\/(.+\.png)$/)?.[1];
  if (!rel) return "";
  const diff = rel.replace(/\.png$/, ".diff.png");
  return `<div class="shots"><img src="${esc(rel)}" alt="${esc(rel)}">${existsSync(path.join(out, diff)) ? `<img src="${esc(diff)}" alt="${esc(diff)}">` : ""}</div>`;
};

const html = `<!doctype html><meta charset="utf-8"><title>Verify run</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--ok:#1f7a3d;--fail:#c4261d}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#f2f2f2;--muted:#9a9a9f;--line:#2c2c2e;--ok:#4cc27a;--fail:#ff6b5f}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px 16px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.pass,.ok{color:var(--ok)}.fail{color:var(--fail)}.none,.meta,.log{color:var(--muted)}
pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;margin:0}.shots{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
.shots img{max-width:520px;width:100%;border:1px solid var(--line)}h2{margin-top:32px}
</style>
<h1>Verify run ${esc(path.basename(out))}</h1>
<p>${journeys.filter((j) => j.passed).length}/${journeys.length} journeys passed. DoD: ${count("pass")} pass, ${count("fail")} fail, ${count("none")} without a journey.</p>
<h2>DoD</h2><table><tr><th>Id</th><th>Pass criterion</th><th>Journeys</th><th>State</th></tr>
${dodRows.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.criterion)}</td><td>${r.by.map((j) => `<a href="#${j.name}">${j.name}</a>`).join(", ")}</td><td class="${r.state}">${r.state}</td></tr>`).join("\n")}
</table>
${journeys.map((j) => `<h2 id="${j.name}" class="${j.passed ? "pass" : "fail"}">${j.name}: ${j.passed ? "pass" : "FAIL"}${j.dod.length ? ` (${j.dod.join(", ")})` : ""}</h2>
${j.lines.map((l) => `<pre class="${lineClass(l)}">${esc(l)}</pre>${shot(l)}`).join("\n")}`).join("\n")}
`;
writeFileSync(path.join(out, "report.html"), html);
console.log(`run-all: report ${path.join(out, "report.html")}`);
