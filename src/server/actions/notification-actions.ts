"use server";

import { listNotifications, markAllRead, markRead, unreadCount, type NotificationRow } from "@/server/notifications/store";

type SimpleResult = { ok: true } | { ok: false; error: string };

/**
 * The notification center's read path: everything the bell needs in one round trip
 * (the list plus the count) rather than two separate actions racing each other on the
 * client. Thin wrapper over `src/server/notifications/store`, same "actions file is the
 * only 'use server' boundary, the store stays a plain module" split settings-actions.ts
 * already uses for `getAppSettingsAction`.
 */
export interface NotificationsSnapshot {
  notifications: NotificationRow[];
  unreadCount: number;
}

export async function listNotificationsAction(): Promise<NotificationsSnapshot> {
  return { notifications: listNotifications(), unreadCount: unreadCount() };
}

export async function markReadAction(id: number): Promise<SimpleResult> {
  try {
    markRead(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function markAllReadAction(): Promise<SimpleResult> {
  try {
    markAllRead();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
