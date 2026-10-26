// Compares two baseline folders shot by baseline-v2, file by file, and fails when a shot
// differs by more than BASELINE_DIFF_MAX (default 0.5%) of its pixels.
import { readdirSync } from "node:fs";
import path from "node:path";
import { pngDiff } from "./png-diff.mjs";

const [want, got] = process.argv.slice(2);
if (!want || !got) throw new Error("usage: baseline-diff.mjs <approved dir> <new dir>");
const max = Number(process.env.BASELINE_DIFF_MAX ?? 0.005);
let failed = 0;
for (const file of readdirSync(want).filter((f) => f.endsWith(".png")).sort()) {
  const { share, error } = pngDiff(path.join(want, file), path.join(got, file));
  const ok = !error && share <= max;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${error ?? `${(share * 100).toFixed(2)}% of pixels differ`}`);
}
process.exit(failed ? 1 : 0);
