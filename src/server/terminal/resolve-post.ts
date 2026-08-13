import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";

/** Resolves a planned post's title for the terminal websocket to derive a sandbox dir
 *  from (see ws.ts's attachTerminal). Only the title is needed here, so this selects
 *  just that column rather than pulling in the full PlannedPostRow shape from
 *  planned-posts.ts. */
export async function getPlannedPostTitleById(postId: string): Promise<string | null> {
  const rows = await db.select({ title: tables.plannedPosts.title }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, postId)).limit(1);
  return rows[0]?.title ?? null;
}
