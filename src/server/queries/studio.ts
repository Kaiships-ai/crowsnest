import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { rowToAnalysis, type StoredVideoAnalysis } from "@/server/services/analyze";
import { getRemixSession, type RemixSessionRow } from "@/server/services/remix";
import { getPlannedPostById, type PlannedPostRow } from "./planned-posts";
import { getVideoDetail, type VideoDetail } from "./video";

/**
 * The remix half of a studio brief: the session the plan came out of, plus the analysis
 * of the video THAT SESSION was remixing.
 *
 * The analysis is loaded off the session's own `sourceVideoId` rather than reused from
 * `video` above. In the normal flow (finishRemix) the two are the same row, but a plan
 * can be edited by hand, and if they ever diverge the hook and beats must describe the
 * video the remix was actually built from. Otherwise the brief would attribute one
 * video's beats to another remix's hook.
 */
export interface StudioRemix {
  session: RemixSessionRow;
  sourceAnalysis: StoredVideoAnalysis | null;
}

export interface StudioBrief {
  plan: PlannedPostRow;
  video: VideoDetail | null;
  /** Null when the plan carries no `remixSessionId`, or when that session is gone. */
  remix: StudioRemix | null;
}

/**
 * The Studio shell's one-post brief (content machine v1, task 2): the plan itself plus
 * the source video's detail (including the frame pass layout in `analysis`), composed
 * from the two single-record loaders that already exist rather than a new join. `video`
 * is null when the plan carries no `sourceVideoId` — a plan is allowed to exist before
 * it has a source video attached.
 *
 * `remix` follows `plan.remixSessionId` back to the session the plan came from, which is
 * how the remix's chosen hook and enriched beats reach the cook. The link column was
 * already there and already populated (stage-script's add-to-plan, and now finishRemix);
 * nothing read it until this.
 */
export async function getStudioBrief(postId: string): Promise<StudioBrief | null> {
  const plan = await getPlannedPostById(postId);
  if (!plan) return null;
  const video = plan.sourceVideoId ? await getVideoDetail(plan.sourceVideoId) : null;

  let remix: StudioRemix | null = null;
  if (plan.remixSessionId) {
    const session = await getRemixSession(plan.remixSessionId);
    if (session) {
      const [row] = await db
        .select()
        .from(tables.videoAnalyses)
        .where(eq(tables.videoAnalyses.videoId, session.sourceVideoId))
        .limit(1);
      remix = { session, sourceAnalysis: row ? rowToAnalysis(row) : null };
    }
  }

  return { plan, video, remix };
}
