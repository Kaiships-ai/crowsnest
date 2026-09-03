import { db as defaultDb, tables } from "../db";

/**
 * Batch-insert helpers for the sync engine (Goal 3 T4).
 *
 * Today each synced item does its own `videoSnapshots` insert - a page of 30 is 30
 * transactions. These helpers write a whole page's rows in one multi-row statement. Kept
 * deliberately dumb: no failure isolation, no chunking, no id generation. T4 wires them
 * into `runSync`'s per-page loop and owns the per-row fallback for a poison row.
 */

export type VideoSnapshotInsert = typeof tables.videoSnapshots.$inferInsert;

/** The one method these helpers call. Typing the parameter this loosely lets a caller
 *  pass a transaction handle and lets a test pass a spy, without dragging in the full
 *  drizzle db type. */
type SnapshotInserter = {
  insert: (table: typeof tables.videoSnapshots) => { values: (rows: VideoSnapshotInsert[]) => unknown };
};

/** Inserts an array of `videoSnapshots` rows in one multi-row `insert().values([...])`.
 *  No-op (and no db round trip) when the array is empty. Returns the drizzle insert so a
 *  caller can `await` it; returns undefined for the empty case. */
export function insertVideoSnapshots(rows: VideoSnapshotInsert[], dbLike: SnapshotInserter = defaultDb) {
  if (rows.length === 0) return undefined;
  return dbLike.insert(tables.videoSnapshots).values(rows);
}
