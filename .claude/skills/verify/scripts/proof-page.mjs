// proof-page.mjs <proof-dir> -- the one page Kai opens to decide a PR: what he will see, the video,
// prototype | before | after shots per state, real numbers against their source, checks, cost, undo.
// Reads <proof-dir>/proof.json and writes <proof-dir>/index.html; media paths in proof.json are relative to <proof-dir>.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
const proof = JSON.parse(readFileSync(path.join(dir, "proof.json"), "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const missing = [proof.video, ...proof.states.flatMap((s) => [s.prototype, s.before, s.after])]
  .filter((f) => f && !existsSync(path.join(dir, f)));
if (missing.length) throw new Error(`proof-page: missing files in ${dir}: ${missing.join(", ")}`);

const RISK = { low: "THẤP · CI xanh là tự merge", medium: "VỪA · anh xem trang này", high: "CAO · anh xem trang này và chạy thật 1 lần trên app của anh" };
const shot = (f, label) => (f ? `<figure><a href="${esc(f)}"><img src="${esc(f)}" alt="${esc(label)}"></a><figcaption>${esc(label)}</figcaption></figure>` : `<figure class="none"><span>không có ảnh</span><figcaption>${esc(label)}</figcaption></figure>`);
const states = proof.states
  .map((s) => `<h3>${esc(s.name)}</h3><div class="row">${shot(s.prototype, "Prototype")}${shot(s.before, "Trước (main)")}${shot(s.after, "Sau (PR này)")}</div>`)
  .join("");
const numbers = proof.numbers
  .map((n) => `<tr><td>${esc(n.label)}</td><td>${esc(n.source)}: <b>${esc(n.expected)}</b></td><td>App: <b>${esc(n.app)}</b></td><td class="${n.expected === n.app ? "ok" : "bad"}">${n.expected === n.app ? "✓ khớp" : "✗ lệch"}</td></tr>`)
  .join("");
const checks = proof.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"} ${esc(c.label)}</li>`).join("");

// A body fragment, no doctype/html/head: claude.ai artifacts wrap it in their own skeleton, and browsers open it as is.
const html = `<title>Proof PR ${esc(proof.pr)}</title><meta name="claude:viewport-fit-sides" content="cover"><style>
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#e5e5e5;--ok:#1a7f37;--bad:#c62828;--video:#000}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111;--fg:#eee;--muted:#999;--line:#2a2a2a;--ok:#4cc26b;--bad:#ef6b6b;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111;--fg:#eee;--muted:#999;--line:#2a2a2a;--ok:#4cc26b;--bad:#ef6b6b;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:14px;color:var(--muted);margin:16px 0 6px}
.risk{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:2px 10px;font-size:13px}ol{padding-left:20px}
video{width:100%;max-height:70vh;background:var(--video);border-radius:8px}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
figure{margin:0}img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}figcaption{font-size:12px;color:var(--muted)}
.none span{display:flex;align-items:center;justify-content:center;aspect-ratio:16/10;border:1px dashed var(--line);border-radius:6px;color:var(--muted)}
table{border-collapse:collapse;width:100%}td{border-bottom:1px solid var(--line);padding:8px 6px;font-size:14px}.ok{color:var(--ok)}.bad{color:var(--bad)}
a{color:inherit}ul{list-style:none;padding:0}.meta{color:var(--muted);font-size:14px}@media (max-width:640px){.row{grid-template-columns:1fr}}
</style><main>
<h1>PR #${esc(proof.pr)} · ${esc(proof.title)}</h1><span class="risk">Rủi ro ${esc(RISK[proof.risk] ?? proof.risk)}</span>
<h2>Anh sẽ thấy</h2><ol>${proof.youWillSee.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<h2>Video</h2>${proof.video ? `<video src="${esc(proof.video)}" controls playsinline></video>` : `<p class="bad">Chưa có video.</p>`}
<h2>Prototype, trước và sau</h2>${states}
<h2>Số thật</h2>${proof.numbers.length ? `<table>${numbers}</table>` : `<p class="meta">PR này không hiện số nào.</p>`}
<h2>Đã kiểm</h2><ul>${checks}</ul>
<h2>Chi phí và hoàn tác</h2><p class="meta">${esc(proof.cost)}</p><p class="meta">Hoàn tác: ${esc(proof.undo)}</p>
<p class="meta"><a href="${esc(proof.prUrl)}">Quay lại PR</a> để bấm Auto-merge, hoặc ghi lỗi ở đó.</p>
</main>`;

writeFileSync(path.join(dir, "index.html"), html);
const passed = proof.checks.filter((c) => c.ok).length;
const matched = proof.numbers.filter((n) => n.expected === n.app).length;
writeFileSync(path.join(dir, "comment.md"), [
  `**Trang bằng chứng** · rủi ro ${RISK[proof.risk] ?? proof.risk}`,
  `Đã kiểm ${passed}/${proof.checks.length} · số thật khớp ${matched}/${proof.numbers.length} · ${proof.video ? "có video" : "chưa có video"}`,
  `▶ ${proof.pageUrl ?? "PAGE_URL"}`,
].join("\n\n") + "\n");
console.log(path.join(dir, "index.html"));
