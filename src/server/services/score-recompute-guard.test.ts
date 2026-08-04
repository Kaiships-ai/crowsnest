import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Structural guard for the correctness risk named in review-engineering-2026-07-31.md §5
 * (B4 in docs/product/v1-to-product-backlog.html): `videos.outlier_score` is a stored
 * column, recomputed on write, not derived on read. Today exactly three functions mutate
 * the columns a score is computed from, `upsertVideo`, `softDeleteMissing` and
 * `enrichViewCounts` (which writes `view_count` from Instagram's single-media endpoint,
 * and runs before the recompute in `syncOneChannel` for exactly this reason), all three
 * in `sync-engine.ts`, and all three followed by a call to `recomputeChannelScores`
 * before the sync (or import) that triggered them returns. That is a convention, not
 * something the schema enforces, and this exact shape already produced two real bugs
 * today, fixed in commits 1109299 and 53ed4c9.
 *
 * Of the three options the review offered (a single chokepoint owning score writes, a
 * type that cannot be constructed without a recompute, or a test that fails when a new
 * write path appears), this file is the third. A chokepoint or a non-constructible type
 * would mean restructuring how `upsertVideo` writes each post mid-page: real surgery on
 * the most heavily tested file in the app, for a one-person local tool, to guard against
 * a write path that does not exist yet. A test that fails the moment one appears gets the
 * same practical protection (a silent new write path becomes a loud CI failure instead)
 * for a few dozen lines, which is the proportionate choice here.
 *
 * This cannot prove a write is followed by a recompute. That is what the regression
 * tests in `sync-engine.test.ts`, `channels.test.ts`, and `settings-actions.test.ts`
 * already prove for the paths that exist today. What it proves is narrower and fully
 * mechanical: no file other than the two allow-listed below writes to `tables.videos` at
 * all. A manual view-count correction, a bulk re-import, anything new that touches
 * `videos` from outside this allow-list, fails here, on purpose, until whoever wrote it
 * either wires a recompute and widens ALLOWED_FILES deliberately, or discovers they
 * didn't need the write.
 */

const SRC_ROOT = join(__dirname, "..", ".."); // .../src

/** The only files allowed to write `tables.videos` today, and why each is safe:
 *   - sync-engine.ts: every write (`upsertVideo`, `softDeleteMissing`, `enrichViewCounts`)
 *     is followed by `recomputeChannelScores` before `syncOneChannel` / `importReelByUrl`
 *     returns.
 *   - media-actions.ts: writes `videoAssetId` / `lastRefreshedAt` only. Verified below,
 *     not just claimed: never `viewCount` or `deletedAt`, so it can never change which
 *     posts or what numbers a score is computed from. */
const ALLOWED_FILES = new Set(["server/services/sync-engine.ts", "server/actions/media-actions.ts"]);

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) listTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const WRITE_CALL = /\.(update|insert)\(\s*tables\.videos\s*\)/g;

/** Line numbers of every `db.update(tables.videos)` / `tx.insert(tables.videos)` style
 *  call in `source`, regardless of which columns the write touches. */
function writeLineNumbers(source: string): number[] {
  const lines: number[] = [];
  let m: RegExpExecArray | null;
  WRITE_CALL.lastIndex = 0;
  while ((m = WRITE_CALL.exec(source))) {
    lines.push(source.slice(0, m.index).split("\n").length);
  }
  return lines;
}

/** The `.set({...})` / `.values({...})` body chained onto the write call starting at
 *  `callStart`, found by depth-counting parens from that call's own opening paren. Used
 *  only for the media-actions.ts fine-grained check below, where "does this write touch
 *  viewCount or deletedAt" is the actual question, not just "is there a write here". */
function chainedCallBody(source: string, callStart: number): string {
  const after = source.slice(callStart);
  const chain = /^\.(?:update|insert)\(\s*tables\.videos\s*\)\s*\.(set|values)\(/.exec(after);
  if (!chain) return "";
  const openIdx = callStart + chain[0].length - 1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") depth--;
    i++;
  }
  return source.slice(openIdx, i);
}

describe("score recompute structural guard (review-engineering-2026-07-31.md §5, backlog B4)", () => {
  // Planted control (see sweep-needs-a-planted-control): prove the detector can find a
  // real violation before trusting it to report "found nothing" on the actual tree.
  test("the file scan can actually find a write site", () => {
    const fake = `await db.update(tables.videos).set({ viewCount: 1 }).where(eq(tables.videos.id, "x"));`;
    expect(writeLineNumbers(fake)).toEqual([1]);
  });

  test("sync-engine.ts still contains its known write sites; zero here means the detector broke, not that the writes went away", () => {
    const source = readFileSync(join(SRC_ROOT, "server/services/sync-engine.ts"), "utf8");
    // upsertVideo's update, upsertVideo's insert, softDeleteMissing's update.
    expect(writeLineNumbers(source).length).toBeGreaterThanOrEqual(3);
  });

  test("no file outside the allow-list writes to tables.videos", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join("/");
      if (ALLOWED_FILES.has(rel)) continue;
      const lines = writeLineNumbers(readFileSync(file, "utf8"));
      if (lines.length > 0) offenders.push(`${rel}:${lines.join(",")}`);
    }
    expect(
      offenders,
      "A new file writes to tables.videos without being on this guard's allow-list. " +
        "If that write touches viewCount or deletedAt, it changes what a channel's outlier " +
        "score means. Wire a call to recomputeChannelScores for the affected channel, then " +
        "add the file to ALLOWED_FILES above on purpose."
    ).toEqual([]);
  });

  test("media-actions.ts's exemption holds: its write never touches viewCount or deletedAt", () => {
    const source = readFileSync(join(SRC_ROOT, "server/actions/media-actions.ts"), "utf8");
    WRITE_CALL.lastIndex = 0;
    let checked = 0;
    let m: RegExpExecArray | null;
    while ((m = WRITE_CALL.exec(source))) {
      const body = chainedCallBody(source, m.index);
      expect(body).not.toMatch(/\bviewCount\s*[,:]/);
      expect(body).not.toMatch(/\bdeletedAt\s*[,:]/);
      checked++;
    }
    // Same planted-control reasoning as above: prove there was something to check.
    expect(checked).toBeGreaterThan(0);
  });
});
