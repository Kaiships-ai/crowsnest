import { desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

export type NotificationKind = "run_failed" | "run_finished" | "sla_breach";

export interface NotificationRow {
  id: number;
  createdAt: string;
  kind: NotificationKind;
  runId: string | null;
  title: string;
  body: string;
  readAt: string | null;
}

const DEFAULT_LIMIT = 50;

export function insertNotification(n: {
  kind: NotificationKind;
  runId?: string | null;
  title: string;
  body: string;
}): void {
  db.insert(notifications)
    .values({
      createdAt: new Date().toISOString(),
      kind: n.kind,
      runId: n.runId ?? null,
      title: n.title,
      body: n.body,
    })
    .run();
}

export function listNotifications(limit: number = DEFAULT_LIMIT): NotificationRow[] {
  const rows = db.select().from(notifications).orderBy(desc(notifications.id)).limit(limit).all();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    kind: r.kind as NotificationKind,
    runId: r.runId,
    title: r.title,
    body: r.body,
    readAt: r.readAt,
  }));
}

export function unreadCount(): number {
  return db.select().from(notifications).where(isNull(notifications.readAt)).all().length;
}

export function markRead(id: number): void {
  db.update(notifications).set({ readAt: new Date().toISOString() }).where(eq(notifications.id, id)).run();
}

export function markAllRead(): void {
  db.update(notifications).set({ readAt: new Date().toISOString() }).where(isNull(notifications.readAt)).run();
}
