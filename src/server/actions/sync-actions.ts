"use server";

import { desc } from "drizzle-orm";
import { db, tables } from "../db";
import type { Platform } from "../providers/types";
import { addChannel, importReelByUrl, runSync, type SyncResult } from "../services/sync-engine";

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Thin "use server" wrappers around the sync-engine (Task 6): every export here
 * catches and returns `{ ok: false, error }` instead of throwing across the server
 * action boundary — all real logic lives in `services/sync-engine.ts`, which is
 * already fully covered by its own tests.
 */

export async function syncAllAction(): Promise<ActionResult<SyncResult>> {
  try {
    const result = await runSync();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function syncChannelAction(channelId: string): Promise<ActionResult<SyncResult>> {
  try {
    const result = await runSync({ channelIds: [channelId] });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function addChannelAction(handle: string, platform: Platform): Promise<ActionResult<{ channelId: string }>> {
  try {
    const result = await addChannel({ handle, platform });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function importReelAction(url: string): Promise<ActionResult<{ videoId: string; channelId: string }>> {
  try {
    const result = await importReelByUrl(url);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function getLatestSyncJob(): Promise<ActionResult<{ job: typeof tables.syncJobs.$inferSelect | null }>> {
  try {
    const rows = await db.select().from(tables.syncJobs).orderBy(desc(tables.syncJobs.startedAt)).limit(1);
    return { ok: true, job: rows[0] ?? null };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
