"use server";

import { getSyncStatus } from "./sync-status";

/**
 * The sidebar footer is a client component (it needs interactivity for the refresh
 * button and lives inside the "use client" CommandMenu tree), so it can't import
 * getSyncStatus directly — that would pull better-sqlite3 into the client bundle.
 * Same lazy-fetch-via-Server-Action shape as preview-action.ts.
 */
export async function getSyncStatusAction() {
  return getSyncStatus();
}
