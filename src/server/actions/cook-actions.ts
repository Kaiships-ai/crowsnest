"use server";

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, nowIso, tables } from "../db";
import type { ActionResult, SimpleResult } from "../lib/action-result";
import { clockNow } from "../lib/clock";
import { planCardState, type PlanCardState } from "../queries/plan-board";
import { cookVersions, finalMp4, pickCookVersion, readCookIndex, recordCookRound, renderSlotFilms, snapshotCookVersion, type CookRound, type CookVersion } from "./cook-versions";

/** studio-reel's checkout. A verify lane (ORCA_E2E_USER_DATA_DIR) must name its temp copy in
 *  LEAD_STUDIO_COOK_ROOT and never falls back to the real one. */
export function cookRoot(): string | null {
  if (process.env.LEAD_STUDIO_COOK_ROOT) return process.env.LEAD_STUDIO_COOK_ROOT;
  return process.env.ORCA_E2E_USER_DATA_DIR ? null : path.join(os.homedir(), "Desktop/kaiships/studio-reel");
}

/** The title in ASCII with dashes, plus the end of the id, so two reels never share a script file. */
export const reelSlug = (title: string, id: string): string =>
  `${title} ${id.slice(-6)}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-60)
    .replace(/^-+/, "");

const COOKABLE: PlanCardState[] = ["draft", "plan", "missed"];
const GONE = { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" } as const;
const ALREADY = { ok: false, error: "This reel is already cooking.", code: "COOK_ALREADY" } as const;

/** Writes the reel's script where studio-reel's /make-reel reads it, in its workspace/README.md format. */
export async function cookPlanCardAction(id: string): Promise<ActionResult<{ root: string; scriptPath: string; title: string }>> {
  const [row] = await db
    .select({ plan: tables.plannedPosts, script: tables.scripts.content })
    .from(tables.plannedPosts)
    .leftJoin(tables.scripts, eq(tables.scripts.id, tables.plannedPosts.scriptId))
    .where(eq(tables.plannedPosts.id, id))
    .limit(1);
  if (!row) return GONE;
  const { plan } = row;
  if (plan.cookWorkspaceId) return ALREADY;
  if (!COOKABLE.includes(planCardState(plan, clockNow().toLocaleDateString("sv-SE")))) return { ok: false, error: "Only a draft or planned reel can be cooked.", code: "COOK_LOCKED" };
  if (!row.script?.trim()) return { ok: false, error: "This reel has no script to cook.", code: "COOK_NO_SCRIPT" };
  const root = cookRoot();
  if (!root || !existsSync(root)) return { ok: false, error: root ? `studio-reel is not at ${root}.` : "This verify lane names no studio-reel copy (LEAD_STUDIO_COOK_ROOT).", code: "COOK_NO_STUDIO" };
  const slug = reelSlug(plan.title, id);
  const scriptPath = `workspace/scripts/${slug}.md`;
  const front = [`slug: ${slug}`, plan.targetLengthSec ? `target_seconds: ${plan.targetLengthSec}` : null, plan.keyword ? `cta_keyword: ${plan.keyword}` : null, plan.keyword ? `campaign: ${plan.keyword}` : null, "status: draft"].filter(Boolean);
  await mkdir(path.join(root, "workspace/scripts"), { recursive: true });
  await writeFile(path.join(root, scriptPath), `---\n${front.join("\n")}\n---\n# ${plan.title}\n\n## Script\n${row.script.trim()}\n`);
  return { ok: true, root, scriptPath, title: plan.title };
}

/** Marks the reel Cooking once its workspace exists; a reel already cooking is refused. */
export async function markPlanCookingAction(id: string, workspaceId: string): Promise<SimpleResult> {
  const updated = await db
    .update(tables.plannedPosts)
    .set({ cookWorkspaceId: workspaceId, updatedAt: nowIso() })
    .where(and(eq(tables.plannedPosts.id, id), isNull(tables.plannedPosts.cookWorkspaceId)))
    .returning({ id: tables.plannedPosts.id });
  if (updated.length) return { ok: true };
  const [exists] = await db.select({ id: tables.plannedPosts.id }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  return exists ? ALREADY : GONE;
}

/** Rolls Cooking back when Claude did not start in that workspace, so Cook can be retried. */
export async function clearPlanCookingAction(id: string, workspaceId: string): Promise<SimpleResult> {
  await db
    .update(tables.plannedPosts)
    .set({ cookWorkspaceId: null, updatedAt: nowIso() })
    .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.cookWorkspaceId, workspaceId)));
  return { ok: true };
}

// films/<slug>/job.json as studio-reel's core/job.mjs writes it. started/ended are proposed and may be absent.
const JobStep = z.object({
  name: z.string(),
  status: z.enum(["pending", "running", "done", "failed", "waiting"]),
  files: z.array(z.string()).optional(),
  pct: z.number().optional(),
  pid: z.number().optional(),
  started: z.string().optional(),
  ended: z.string().optional(),
});
const Job = z.object({
  steps: z.array(JobStep),
  outputs: z.array(z.string()).default([]),
  qa: z.string().optional(),
  style: z.string().optional(),
  // Proposed: `job.mjs … deliver done --change="…"`, what a feedback round changed.
  change: z.string().optional(),
});
export type CookJobStep = z.infer<typeof JobStep>;

export type CookView = {
  title: string;
  slug: string;
  keyword: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  /** The plan row still links a workspace; false after a Cook whose Claude never started was rolled back. */
  cooking: boolean;
  /** The workspace the plan row links while cooking; Stop cook clears it. */
  workspaceId: string | null;
  /** When this Mac last booted (ms): a cook last seen before it did not survive a restart. */
  bootedAt: number;
  /** studio-reel's root, where Resume starts Claude again. */
  root: string | null;
  /** The plan's own script, shown until vo/script.json exists. */
  planScript: string | null;
  steps: CookJobStep[] | null;
  qa: string | null;
  style: string | null;
  /** vo/script.json lines once Claude wrote them. */
  scriptLines: string[] | null;
  /** Seconds the running step has run: its `started`, else its first running write; null when neither is known. */
  elapsedSec: number | null;
  /** The running step's pid is gone (killed or crashed); null when it has no pid. */
  pidGone: boolean | null;
  /** Median of this Mac's last 5 renders; 180 s until 3 renders carry started and ended. */
  usualRenderSec: number;
  /** The newest playable file (proposal 4): the final once render is done, else the draft once draft is done. */
  video: { kind: "draft" | "final"; file: string; mtime: number } | null;
  /** versions/v1..vN, saved by Lead Studio each time deliver turns done (proposal 3). */
  versions: CookVersion[];
  /** Feedback rounds Kai sent; round n was made from version `from`. */
  rounds: CookRound[];
  /** The version Gate 2 gets; null means the newest. */
  use: number | null;
  /** The render waits for studio-reel's render slot (RENDER_SLOTS=1) while another reel renders. */
  renderQueue: { behind: string | null; startsInSec: number | null } | null;
};

const firstSeen = new Map<string, number | null>();
const DEFAULT_RENDER_SEC = 180;

const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Render durations from every film's job.json, newest first. ponytail: rescans films/ each poll, cache by mtime if films/ grows large. */
async function usualRenderSec(root: string): Promise<number> {
  const films = await readdir(path.join(root, "films")).catch(() => [] as string[]);
  const runs: { ended: number; sec: number }[] = [];
  for (const film of films) {
    const job = Job.safeParse(await readJson(path.join(root, "films", film, "job.json")));
    const render = job.success ? job.data.steps.find((s) => s.name === "render" && s.status === "done") : undefined;
    const start = Date.parse(render?.started ?? ""), end = Date.parse(render?.ended ?? "");
    if (end > start) runs.push({ ended: end, sec: (end - start) / 1000 });
  }
  const last = runs.sort((a, b) => b.ended - a.ended).slice(0, 5);
  return last.length >= 3 ? Math.round(median(last.map((r) => r.sec))) : DEFAULT_RENDER_SEC;
}

/** What the Cook pane draws for one plan row: the row, its film's job.json and vo/script.json. */
export async function getCookView(id: string): Promise<ActionResult<CookView>> {
  const [row] = await db
    .select({ plan: tables.plannedPosts, script: tables.scripts.content })
    .from(tables.plannedPosts)
    .leftJoin(tables.scripts, eq(tables.scripts.id, tables.plannedPosts.scriptId))
    .where(eq(tables.plannedPosts.id, id))
    .limit(1);
  if (!row) return GONE;
  const { plan } = row;
  const slug = reelSlug(plan.title, id);
  const root = cookRoot();
  const film = root ? path.join(root, "films", slug) : null;
  const jobFile = film ? path.join(film, "job.json") : null;
  const job = jobFile ? Job.safeParse(await readJson(jobFile)) : null;
  const steps = job?.success ? job.data.steps : null;
  const running = steps?.find((s) => s.status === "running");
  for (const key of firstSeen.keys()) if (key.startsWith(`${slug}:`) && key !== `${slug}:${running?.name}`) firstSeen.delete(key);
  let elapsedSec: number | null = null;
  if (running && jobFile) {
    const key = `${slug}:${running.name}`;
    // Without `started`, the file's mtime is the step's start only while it is the step's first running write: a step
    // that reports pct rewrites job.json on each update, so one first seen past 0% has an unknown start (null).
    if (!firstSeen.has(key)) firstSeen.set(key, running.pct ? null : (await stat(jobFile)).mtimeMs);
    const since = Date.parse(running.started ?? "") || firstSeen.get(key);
    if (since) elapsedSec = Math.max(0, Math.round((Date.now() - since) / 1000));
  }
  const done = (name: string) => steps?.find((s) => s.name === name)?.status === "done";
  const outputs = job?.success ? job.data.outputs : [];
  const final = finalMp4(outputs);
  const draft = outputs.find((f) => f.endsWith("draft.mp4"));
  const playable = !film ? null : done("render") && final ? { kind: "final" as const, file: path.join(film, final) } : done("draft") && draft ? { kind: "draft" as const, file: path.join(film, draft) } : null;
  const mtime = playable ? (await stat(playable.file).catch(() => null))?.mtimeMs : undefined;
  const video = playable && mtime != null ? { ...playable, mtime } : null;
  const index = film && job?.success && done("deliver") ? await snapshotCookVersion(film, job.data) : film ? await readCookIndex(film) : null;
  const pidGone = running?.pid != null ? !pidAlive(running.pid) : null;
  const usual = root ? await usualRenderSec(root) : DEFAULT_RENDER_SEC;
  const renderQueue = root && running?.name === "render" && !pidGone ? await queuedBehind(root, slug, usual) : null;
  const vo = film ? z.object({ lines: z.array(z.object({ text: z.string() })) }).safeParse(await readJson(path.join(film, "vo/script.json"))) : null;
  return {
    ok: true,
    title: plan.title,
    slug,
    keyword: plan.keyword,
    plannedDate: plan.plannedDate,
    plannedTime: plan.plannedTime,
    cooking: plan.cookWorkspaceId != null,
    workspaceId: plan.cookWorkspaceId,
    bootedAt: Math.round(Date.now() - os.uptime() * 1000),
    root,
    planScript: row.script?.trim() || null,
    steps,
    qa: job?.success ? (job.data.qa ?? null) : null,
    style: job?.success ? (job.data.style ?? null) : null,
    scriptLines: vo?.success ? vo.data.lines.map((l) => l.text) : null,
    elapsedSec,
    pidGone,
    usualRenderSec: usual,
    video,
    versions: film && index ? await cookVersions(film, index) : [],
    rounds: index?.rounds ?? [],
    use: index?.use ?? null,
    renderQueue,
  };
}

/** In line for the render (proto 40): a render slot is held, and not by this film. */
async function queuedBehind(root: string, slug: string, usual: number): Promise<CookView["renderQueue"]> {
  const films = await renderSlotFilms();
  if (!films || films.includes(slug)) return null;
  const other = films.find(Boolean);
  if (!other) return { behind: null, startsInSec: null };
  const rows = await db.select({ id: tables.plannedPosts.id, title: tables.plannedPosts.title }).from(tables.plannedPosts);
  const job = Job.safeParse(await readJson(path.join(root, "films", other, "job.json")));
  const started = Date.parse((job.success ? job.data.steps.find((s) => s.name === "render")?.started : undefined) ?? "");
  return {
    behind: rows.find((r) => reelSlug(r.title, r.id) === other)?.title ?? null,
    startsInSec: started ? Math.max(0, Math.round(usual - (Date.now() - started) / 1000)) : null,
  };
}

const filmOf = async (id: string): Promise<string | null> => {
  const [plan] = await db.select({ title: tables.plannedPosts.title }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  const root = cookRoot();
  return plan && root ? path.join(root, "films", reelSlug(plan.title, id)) : null;
};

/** Records a feedback round in versions/index.json and returns the message the pane types into Claude. */
export async function recordCookRoundAction(id: string, note: string): Promise<ActionResult<{ round: number; message: string }>> {
  const film = await filmOf(id);
  const recorded = film && note.trim() ? await recordCookRound(film, note) : null;
  if (!recorded) return { ok: false, error: "There is no saved version to give feedback on yet.", code: "COOK_NO_VERSION" };
  return { ok: true, round: recorded.round.n, message: recorded.message };
}

/** Picks the version Gate 2 gets (Use v1 in Compare). */
export async function pickCookVersionAction(id: string, n: number): Promise<SimpleResult> {
  const film = await filmOf(id);
  return film && (await pickCookVersion(film, n)) ? { ok: true } : { ok: false, error: "That version does not exist.", code: "COOK_NO_VERSION" };
}

/** Every reel cooking now, for the Studio board (proto 39). */
export async function listCooksAction(): Promise<{ id: string; view: Extract<ActionResult<CookView>, { ok: true }> }[]> {
  const rows = await db.select({ id: tables.plannedPosts.id }).from(tables.plannedPosts).where(isNotNull(tables.plannedPosts.cookWorkspaceId));
  const views = await Promise.all(rows.map(async (r) => ({ id: r.id, view: await getCookView(r.id) })));
  return views.flatMap(({ id, view }) => (view.ok ? [{ id, view }] : []));
}
