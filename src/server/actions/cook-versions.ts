import { cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { execFileP } from "../lib/exec";

// films/<slug>/versions/ belongs to Lead Studio alone (proposal 3): Claude reads it, never writes it.
const Version = z.object({
  n: z.number(),
  mp4: z.string(),
  mp4Mtime: z.number(),
  durationSec: z.number().nullable(),
  hookSec: z.number().nullable(),
  qa: z.string().nullable(),
  change: z.string().nullable(),
  savedAt: z.string(),
});
const Round = z.object({ n: z.number(), note: z.string(), from: z.number(), sentAt: z.string() });
const Index = z.object({ versions: z.array(Version).default([]), rounds: z.array(Round).default([]), use: z.number().nullable().default(null) });
export type CookIndex = z.infer<typeof Index>;
export type CookRound = z.infer<typeof Round>;
export type CookVersion = z.infer<typeof Version> & { file: string; scriptLines: string[] | null; caption: string | null };

type JobStep = { name: string; status: string; started?: string; ended?: string };
type CookJob = { steps: JobStep[]; outputs: string[]; qa?: string; change?: string };

const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};
const readText = (file: string): Promise<string | null> => readFile(file, "utf8").catch(() => null);

const indexFile = (film: string): string => path.join(film, "versions/index.json");

export async function readCookIndex(film: string): Promise<CookIndex> {
  const parsed = Index.safeParse(await readJson(indexFile(film)));
  return parsed.success ? parsed.data : { versions: [], rounds: [], use: null };
}

async function writeCookIndex(film: string, index: CookIndex): Promise<void> {
  await mkdir(path.join(film, "versions"), { recursive: true });
  const tmp = `${indexFile(film)}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index, null, 1)}\n`);
  await rename(tmp, indexFile(film));
}

/** The reel's final mp4 among job.json's outputs; the draft lives under out/verify/. */
export const finalMp4 = (outputs: string[]): string | undefined => outputs.find((f) => f.endsWith(".mp4") && !f.startsWith("out/"));

/** An mp4's length from its moov/mvhd box, walking the top-level boxes (moov may sit at the end). */
export async function mp4Duration(file: string): Promise<number | null> {
  const fh = await open(file, "r").catch(() => null);
  if (!fh) return null;
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    for (let at = 0; at + 8 <= size; ) {
      await fh.read(head, 0, 16, at);
      let len = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      let body = 8;
      if (len === 1) [len, body] = [Number(head.readBigUInt64BE(8)), 16];
      if (len < 8) return null;
      if (type === "moov") {
        const moov = Buffer.alloc(Math.min(len - body, 1 << 20));
        await fh.read(moov, 0, moov.length, at + body);
        const m = moov.indexOf("mvhd", 0, "latin1");
        if (m < 4) return null;
        const v1 = moov[m + 4] === 1;
        const scale = moov.readUInt32BE(m + (v1 ? 24 : 16));
        const dur = v1 ? Number(moov.readBigUInt64BE(m + 28)) : moov.readUInt32BE(m + 20);
        return scale ? Math.round((dur / scale) * 10) / 10 : null;
      }
      at += len;
    }
    return null;
  } finally {
    await fh.close();
  }
}

const hookSecOf = async (dir: string): Promise<number | null> => {
  const vo = z.object({ lines: z.array(z.object({ s: z.number(), e: z.number() })) }).safeParse(await readJson(path.join(dir, "vo/vo.json")));
  const first = vo.success ? vo.data.lines[0] : undefined;
  return first ? Math.round((first.e - first.s) * 10) / 10 : null;
};

const scriptLinesOf = async (dir: string): Promise<string[] | null> => {
  const vo = z.object({ lines: z.array(z.object({ text: z.string() })) }).safeParse(await readJson(path.join(dir, "vo/script.json")));
  return vo.success ? vo.data.lines.map((l) => l.text) : null;
};

const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

/** The "changed" chip when job.json carries no fresh `change`: the hook, the length and the script lines. */
export function changeFallback(
  prev: { hookSec: number | null; durationSec: number | null; scriptLines: string[] | null },
  next: { hookSec: number | null; durationSec: number | null; scriptLines: string[] | null },
): string | null {
  const parts: string[] = [];
  if (prev.hookSec != null && next.hookSec != null && prev.hookSec !== next.hookSec) parts.push(`hook ${prev.hookSec} s → ${next.hookSec} s`);
  if (prev.durationSec != null && next.durationSec != null && clock(prev.durationSec) !== clock(next.durationSec)) {
    parts.push(`length ${clock(prev.durationSec)} → ${clock(next.durationSec)}`);
  }
  if (prev.scriptLines && next.scriptLines) {
    const a = prev.scriptLines, b = next.scriptLines;
    const changed = Math.max(a.length, b.length) - a.filter((line, i) => line === b[i]).length;
    if (changed) parts.push(`${changed} script line${changed === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

const snapshots = new Map<string, Promise<CookIndex>>();
// Films whose deliver this process saw not done since their last saved version.
const deliverOpened = new Set<string>();

/** deliver is done for this round, not left done from the last one: a feedback round reruns render, and job.mjs
 *  leaves deliver as it was. deliver's ended (or started) must be after render's ended or the last version's save. */
export function deliveredThisRound(steps: JobStep[], savedAt: string, seenOpen: boolean): boolean {
  const deliver = steps.find((s) => s.name === "deliver");
  const at = Date.parse(deliver?.ended ?? deliver?.started ?? "");
  // ponytail: studio-reel's job.mjs writes no started/ended yet, so then it is "this process saw deliver not done
  // since the last version"; an app restart in between loses that and the round's version waits for the next deliver.
  if (Number.isNaN(at)) return seenOpen;
  return at > Date.parse(steps.find((s) => s.name === "render")?.ended ?? "") || at > Date.parse(savedAt);
}

/** When deliver is done for this round and its final is not saved yet, copies the delivered files plus src/, vo/script.json and
 *  audio/cues.json to versions/vN/. Idempotent: a version is keyed by its final mp4's mtime. */
export function snapshotCookVersion(film: string, job: CookJob): Promise<CookIndex> {
  // Why: the pane and the Studio board poll the same film; one copy at a time, or both would save the same final.
  const pending = snapshots.get(film) ?? snapshot(film, job).finally(() => snapshots.delete(film));
  snapshots.set(film, pending);
  return pending;
}

async function snapshot(film: string, job: CookJob): Promise<CookIndex> {
  const index = await readCookIndex(film);
  if (job.steps.find((s) => s.name === "deliver")?.status !== "done") {
    deliverOpened.add(film);
    return index;
  }
  const mp4 = finalMp4(job.outputs);
  const mtime = mp4 ? (await stat(path.join(film, mp4)).catch(() => null))?.mtimeMs : undefined;
  const last = index.versions.at(-1);
  if (!mp4 || mtime == null || last?.mp4Mtime === mtime) return index;
  if (last && !deliveredThisRound(job.steps, last.savedAt, deliverOpened.has(film))) return index;
  const n = (last?.n ?? 0) + 1;
  const dir = path.join(film, "versions", `v${n}`);
  const copy = (rel: string) => cp(path.join(film, rel), path.join(dir, rel), { recursive: true });
  // Why: no index entry for a version whose mp4 or a file that exists failed to copy, so the next poll retries it.
  try {
    await copy(mp4);
    for (const rel of [...job.outputs.filter((f) => !f.startsWith("out/") && f !== mp4), "src", "vo/script.json", "audio/cues.json"]) {
      await copy(rel).catch((e: unknown) => {
        if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
      });
    }
  } catch {
    return index;
  }
  const [durationSec, hookSec, scriptLines] = [await mp4Duration(path.join(dir, mp4)), await hookSecOf(film), await scriptLinesOf(dir)];
  const prev = last ? { ...last, scriptLines: await scriptLinesOf(path.join(film, "versions", `v${last.n}`)) } : null;
  // Why: a `change` still equal to the last version's was written for that round, not this one.
  const fresh = job.change && job.change !== last?.change ? job.change : null;
  const change = prev ? (fresh ?? changeFallback(prev, { hookSec, durationSec, scriptLines })) : null;
  index.versions.push({ n, mp4, mp4Mtime: mtime, durationSec, hookSec, qa: job.qa ?? null, change, savedAt: new Date().toISOString() });
  await writeCookIndex(film, index);
  deliverOpened.delete(film);
  return index;
}

export async function cookVersions(film: string, index: CookIndex): Promise<CookVersion[]> {
  return Promise.all(
    index.versions.map(async (v) => {
      const dir = path.join(film, "versions", `v${v.n}`);
      return { ...v, file: path.join(dir, v.mp4), scriptLines: await scriptLinesOf(dir), caption: await readText(path.join(dir, "CAPTION.md")) };
    }),
  );
}

/** The post caption in studio-reel's CAPTION.md: the text under its `# Caption` heading, up to the next
 *  section (`## Pinned comment`). A file with no heading is the caption as it is. */
export function postCaption(md: string): string | null {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const start = /^#\s/.test(lines.find((l) => l.trim()) ?? "") ? lines.findIndex((l) => l.trim()) + 1 : 0;
  const rest = lines.slice(start);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim() || null;
}

/** The files Gate 2 gets for version n: its saved mp4, and CAPTION.md. The newest version reads the film's own
 *  CAPTION.md, so a fix by Claude or Kai after deliver shows; an older pick reads the copy saved with it. */
export async function gateFiles(film: string, index: CookIndex, n: number): Promise<{ mp4: string; caption: string | null } | null> {
  const v = index.versions.find((x) => x.n === n);
  if (!v) return null;
  const newest = n === index.versions.at(-1)?.n;
  const md = await readText(path.join(newest ? film : path.join(film, "versions", `v${n}`), "CAPTION.md"));
  return { mp4: path.join(film, "versions", `v${n}`, v.mp4), caption: md == null ? null : postCaption(md) };
}

/** Proto v2's feedback message template, on one line so Enter submits it. */
export const feedbackMessage = (round: number, from: number, note: string): string =>
  `Feedback round ${round} from Lead Studio. v${from} is kept in versions/v${from}/. Note: "${note.replace(/\s+/g, " ").trim()}". Re-run only what this changes, draft first, then the final. End with job.mjs … deliver done --change="…".`;

export async function recordCookRound(film: string, note: string): Promise<{ round: CookRound; message: string } | null> {
  const index = await readCookIndex(film);
  const from = index.versions.at(-1)?.n;
  if (from == null) return null;
  const round = { n: index.rounds.length + 1, note: note.trim(), from, sentAt: new Date().toISOString() };
  index.rounds.push(round);
  await writeCookIndex(film, index);
  return { round, message: feedbackMessage(round.n, from, round.note) };
}

export async function pickCookVersion(film: string, n: number): Promise<boolean> {
  const index = await readCookIndex(film);
  if (!index.versions.some((v) => v.n === n)) return false;
  index.use = n === index.versions.at(-1)?.n ? null : n;
  await writeCookIndex(film, index);
  return true;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
};

/** studio-reel's core/render/slot.mjs: one dir per slot holding the holder's pid and a `beat` it touches every 15 s. With RENDER_SLOTS=1 a render
 *  waits there ("waiting for a render slot") while another reel's video.mjs, whose argv names its film, holds it.
 *  Returns the films holding a slot, or null when no slot is held. */
export async function renderSlotFilms(): Promise<string[] | null> {
  if (process.platform === "win32") return null;
  const uid = process.getuid?.() ?? "u";
  const dir = process.env.RENDER_SLOT_DIR || path.join(os.tmpdir(), `lemo-opuscar-render-slots-${uid}`);
  const slots = (await readdir(dir).catch(() => [] as string[])).filter((d) => /^slot\d+$/.test(d));
  const films: string[] = [];
  for (const slot of slots) {
    const pid = Number((await readText(path.join(dir, slot, "pid")))?.trim());
    if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) continue;
    // Why: slot.mjs takes over a slot whose beat is older than 90 s (a hung holder), so it holds nothing.
    const beat = (await stat(path.join(dir, slot, "beat")).catch(() => null)) ?? (await stat(path.join(dir, slot)).catch(() => null));
    if (!beat || Date.now() - beat.mtimeMs > 90_000) continue;
    const command = (await execFileP("ps", ["-o", "command=", "-p", String(pid)], { timeout: 5_000 }).catch(() => ({ stdout: "" }))).stdout;
    films.push(/films\/([^/\s]+)/.exec(command)?.[1] ?? "");
  }
  return films.length ? films : null;
}
