import type { PlannedPostRow } from "@/server/queries/planned-posts";

export const STEPS = ["Ý tưởng", "Hồ sơ", "Video", "Đăng", "Số 48h"] as const;

export type WeekReel = Pick<
  PlannedPostRow,
  "id" | "title" | "note" | "state" | "plannedDate" | "plannedTime" | "scriptId" | "scriptTitle" | "videoAssetId" | "caption" | "keyword" | "dryRun" | "lastError" | "publishedAt"
>;

export interface FunnelCell {
  source: string;
  metric: string;
  value: number;
  capturedAt: string;
}

export interface DraftVersion {
  id: string;
  version: number;
  diff: string;
}

export type StatusTone = "" | "gate" | "done" | "error";

const hasProfile = (r: WeekReel) => r.scriptId !== null || Boolean(r.caption?.trim());
const readyToPublish = (r: WeekReel) => r.videoAssetId !== null && Boolean(r.caption?.trim());

/** How many of the five steps are done, counted in order: a later step never counts
 *  before an earlier one. Step one is the plan itself, so every reel has at least one.
 *  A dry-run publish never counts as published. */
export function stepsDone(r: WeekReel, hasFunnel: boolean): number {
  const checks = [true, hasProfile(r), r.videoAssetId !== null, r.state === "published" && !r.dryRun, hasFunnel];
  const firstOpen = checks.indexOf(false);
  return firstOpen === -1 ? checks.length : firstOpen;
}

/** The one-line status a reel row shows. A dry run never reads as a plain publish. */
export function reelStatus(r: WeekReel, hasFunnel: boolean): [string, StatusTone] {
  if (r.state === "published") {
    if (r.dryRun) return ["Đã đăng (dry run)", ""];
    return hasFunnel ? ["Xong", "done"] : ["Đã đăng · chờ số 48h", ""];
  }
  if (r.state === "publishing") return ["Đang đăng", ""];
  if (r.state === "failed") return ["Đăng lỗi", "error"];
  if (r.state === "missed") return ["Lỡ lịch", "error"];
  if (readyToPublish(r)) return ["Chờ anh duyệt đăng", "gate"];
  if (hasProfile(r)) return ["Cần video", ""];
  return ["Cần hồ sơ", ""];
}

export type NextAction = { label: string; target: { kind: "reel"; id: string } | { kind: "draft" } } | null;

/** The single next-action chip: the publish gate first, then a waiting plan draft, then
 *  a failed publish, then the first reel that needs a video, then the first that needs a
 *  profile. Reels are in day order. */
export function nextAction(reels: WeekReel[], draft: DraftVersion | null): NextAction {
  const open = reels.filter((r) => r.state !== "published" && r.state !== "publishing");
  const gate = open.find((r) => r.state !== "failed" && readyToPublish(r));
  if (gate) return { label: `Duyệt đăng: ${gate.title}`, target: { kind: "reel", id: gate.id } };
  if (draft) return { label: `Xem bản nháp v${draft.version}`, target: { kind: "draft" } };
  const failed = open.find((r) => r.state === "failed");
  if (failed) return { label: `Sửa lỗi đăng: ${failed.title}`, target: { kind: "reel", id: failed.id } };
  const video = open.find((r) => hasProfile(r) && r.videoAssetId === null);
  if (video) return { label: `Làm video: ${video.title}`, target: { kind: "reel", id: video.id } };
  const profile = open.find((r) => !hasProfile(r));
  if (profile) return { label: `Viết hồ sơ: ${profile.title}`, target: { kind: "reel", id: profile.id } };
  return null;
}

const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Monday to Sunday of the ISO week holding `today` (YYYY-MM-DD). */
export function weekDays(today: string): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(monday + i * 86_400_000)));
}

/** ISO week key, "YYYY-Www", the periodKey plan versions use. */
export function isoWeekKey(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * 86_400_000)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
}

const byTime = <T extends WeekReel>(a: T, b: T) => (a.plannedTime ?? "99").localeCompare(b.plannedTime ?? "99");

/** Today's reels, and every other day of the week as its own list, so two reels on one
 *  day both show. Reels outside the week are dropped. */
export function splitWeek<T extends WeekReel>(reels: T[], today: string): { today: T[]; days: { date: string; reels: T[] }[] } {
  const days = weekDays(today).map((date) => ({ date, reels: reels.filter((r) => r.plannedDate === date).sort(byTime) }));
  return { today: days.find((d) => d.date === today)?.reels ?? [], days: days.filter((d) => d.date !== today) };
}

/** Moves one reel to `date` in a local list, the optimistic half of a drag. */
export function moveReel<T extends WeekReel>(reels: T[], id: string, date: string | null): T[] {
  return reels.map((r) => (r.id === id ? { ...r, plannedDate: date } : r));
}

export const canMove = (r: WeekReel) => r.state !== "published" && r.state !== "publishing";
