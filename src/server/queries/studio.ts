import { getPlannedPostById, type PlannedPostRow } from "./planned-posts";
import { getVideoDetail, type VideoDetail } from "./video";

/**
 * The Studio shell's one-post brief (content machine v1, task 2): the plan itself plus
 * the source video's detail (including the frame pass layout in `analysis`), composed
 * from the two single-record loaders that already exist rather than a new join. `video`
 * is null when the plan carries no `sourceVideoId` — a plan is allowed to exist before
 * it has a source video attached.
 */
export async function getStudioBrief(postId: string): Promise<{ plan: PlannedPostRow; video: VideoDetail | null } | null> {
  const plan = await getPlannedPostById(postId);
  if (!plan) return null;
  const video = plan.sourceVideoId ? await getVideoDetail(plan.sourceVideoId) : null;
  return { plan, video };
}
