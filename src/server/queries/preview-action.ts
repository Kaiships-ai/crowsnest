"use server";

import { getVideoDetail } from "./video";

/**
 * Server Action the quick-preview Sheet calls lazily (only once a card is opened),
 * so the feed grid itself never fetches transcript/analysis data for every visible
 * card up front. Thin wrapper — all the real logic lives in getVideoDetail.
 */
export async function getVideoPreviewAction(id: string) {
  return getVideoDetail(id);
}
