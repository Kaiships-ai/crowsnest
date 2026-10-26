// The share of pixels that differ between two PNG files, or a reason they cannot be compared.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { PNG } = createRequire(path.resolve(import.meta.dirname, "../../../../package.json"))("pngjs");

export function pngDiff(wantFile, gotFile) {
  const a = PNG.sync.read(readFileSync(wantFile));
  let b;
  try {
    b = PNG.sync.read(readFileSync(gotFile));
  } catch {
    return { error: "missing" };
  }
  if (a.width !== b.width || a.height !== b.height) return { error: `${b.width}x${b.height}, approved ${a.width}x${a.height}` };
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) diff++;
  }
  return { share: diff / (a.width * a.height) };
}
