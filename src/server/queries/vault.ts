import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, tables } from "@/server/db";

export interface VaultSourceChip {
  videoId: string;
  channelHandle: string;
}

export interface VaultItemRow {
  id: string;
  type: "hook" | "style";
  title: string;
  templateText: string;
  tags: string[];
  createdAt: string;
  sourceVideo: VaultSourceChip | null;
}

/** Vault template cards (Hooks/Styles tabs), optionally filtered by type, newest first. */
export async function getVaultItems(type?: "hook" | "style"): Promise<VaultItemRow[]> {
  const rows = await db
    .select({
      id: tables.vaultItems.id,
      type: tables.vaultItems.type,
      title: tables.vaultItems.title,
      templateText: tables.vaultItems.templateText,
      tags: tables.vaultItems.tags,
      createdAt: tables.vaultItems.createdAt,
      sourceVideoId: tables.vaultItems.sourceVideoId,
      channelHandle: tables.channels.handle,
    })
    .from(tables.vaultItems)
    .leftJoin(tables.videos, eq(tables.vaultItems.sourceVideoId, tables.videos.id))
    .leftJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(type ? eq(tables.vaultItems.type, type) : undefined)
    .orderBy(desc(tables.vaultItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    type: row.type as "hook" | "style",
    title: row.title,
    templateText: row.templateText,
    tags: row.tags ?? [],
    createdAt: row.createdAt,
    sourceVideo: row.sourceVideoId && row.channelHandle ? { videoId: row.sourceVideoId, channelHandle: row.channelHandle } : null,
  }));
}

export interface ScriptRow {
  id: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sourceVideo: VaultSourceChip | null;
  hookTitle: string | null;
  styleTitle: string | null;
}

/** Vault Scripts tab — reads the separate `scripts` table (not vault_items), newest first. */
export async function getScripts(): Promise<ScriptRow[]> {
  const rows = await db
    .select({
      id: tables.scripts.id,
      title: tables.scripts.title,
      content: tables.scripts.content,
      status: tables.scripts.status,
      createdAt: tables.scripts.createdAt,
      updatedAt: tables.scripts.updatedAt,
      sourceVideoId: tables.scripts.sourceVideoId,
      channelHandle: tables.channels.handle,
      hookVaultItemId: tables.scripts.hookVaultItemId,
      styleVaultItemId: tables.scripts.styleVaultItemId,
    })
    .from(tables.scripts)
    .leftJoin(tables.videos, eq(tables.scripts.sourceVideoId, tables.videos.id))
    .leftJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .orderBy(desc(tables.scripts.createdAt));

  // Batch-resolve hook/style vault item titles (a second small query rather than a
  // self-join, since vault_items would need aliasing twice in one query).
  const vaultIds = Array.from(
    new Set(rows.flatMap((r) => [r.hookVaultItemId, r.styleVaultItemId]).filter((id): id is string => id !== null))
  );
  const titleById = new Map<string, string>();
  if (vaultIds.length > 0) {
    const vaultRows = await db
      .select({ id: tables.vaultItems.id, title: tables.vaultItems.title })
      .from(tables.vaultItems)
      .where(inArray(tables.vaultItems.id, vaultIds));
    for (const v of vaultRows) titleById.set(v.id, v.title);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceVideo: row.sourceVideoId && row.channelHandle ? { videoId: row.sourceVideoId, channelHandle: row.channelHandle } : null,
    hookTitle: row.hookVaultItemId ? (titleById.get(row.hookVaultItemId) ?? null) : null,
    styleTitle: row.styleVaultItemId ? (titleById.get(row.styleVaultItemId) ?? null) : null,
  }));
}

/**
 * Channel Detail's "Vaulted" tab (Task 4 step 4): videoId -> number of vault items
 * sourced from it, for every video that has at least one. Not scoped to a channel —
 * callers filter their own video list against this map, which is fine at this app's
 * single-user/local-SQLite scale.
 */
export async function getVaultedVideoCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ sourceVideoId: tables.vaultItems.sourceVideoId, count: sql<number>`count(*)` })
    .from(tables.vaultItems)
    .where(isNotNull(tables.vaultItems.sourceVideoId))
    .groupBy(tables.vaultItems.sourceVideoId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.sourceVideoId) counts.set(row.sourceVideoId, row.count);
  }
  return counts;
}
