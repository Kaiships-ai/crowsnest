// Compares two baseline folders shot by baseline-v2, file by file, and fails when a shot
// differs by more than BASELINE_DIFF_MAX (default 0.5%) of its pixels.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { PNG } = createRequire(path.resolve(import.meta.dirname, "../../../../package.json"))("pngjs");
const [want, got] = process.argv.slice(2);
if (!want || !got) throw new Error("usage: baseline-diff.mjs <approved dir> <new dir>");
const max = Number(process.env.BASELINE_DIFF_MAX ?? 0.005);
let failed = 0;
for (const file of readdirSync(want).filter((f) => f.endsWith(".png")).sort()) {
  const a = PNG.sync.read(readFileSync(path.join(want, file)));
  let b;
  try {
    b = PNG.sync.read(readFileSync(path.join(got, file)));
  } catch {
    console.log(`FAIL ${file}: missing`);
    failed++;
    continue;
  }
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`FAIL ${file}: ${b.width}x${b.height}, approved ${a.width}x${a.height}`);
    failed++;
    continue;
  }
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) diff++;
  }
  const share = diff / (a.width * a.height);
  const ok = share <= max;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${(share * 100).toFixed(2)}% of pixels differ`);
}
process.exit(failed ? 1 : 0);
