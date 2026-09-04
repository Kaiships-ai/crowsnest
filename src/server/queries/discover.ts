import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/server/db";

export type CreatorSeedRow = {
  handle: string;
  niche: string;
  why: string;
  source: string | null;
  tracked: boolean;
};

export async function listCreatorSeeds(opts?: { niche?: string }): Promise<CreatorSeedRow[]> {
  const rows = await db
    .select({
      handle: tables.creatorSeeds.handle,
      niche: tables.creatorSeeds.niche,
      why: tables.creatorSeeds.why,
      source: tables.creatorSeeds.source,
      trackedChannelId: tables.channels.id,
    })
    .from(tables.creatorSeeds)
    .leftJoin(
      tables.channels,
      and(
        eq(tables.channels.platform, "instagram"),
        // creator_seeds.handle is stored WITHOUT "@" (bootstrap strips it), but
        // channels.handle is stored WITH it (sync-engine.ts normalizeHandle) — prefix
        // the seed handle here so the join actually matches the tracked channel.
        eq(tables.channels.handle, sql`'@' || ${tables.creatorSeeds.handle}`),
        isNull(tables.channels.deletedAt)
      )
    )
    .where(opts?.niche ? eq(tables.creatorSeeds.niche, opts.niche) : undefined)
    .orderBy(asc(tables.creatorSeeds.niche), asc(tables.creatorSeeds.handle));

  return rows.map((row) => ({
    handle: row.handle,
    niche: row.niche,
    why: row.why,
    source: row.source,
    tracked: row.trackedChannelId !== null,
  }));
}
