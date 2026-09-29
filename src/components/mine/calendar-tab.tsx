import { MineCalendar } from "./mine-calendar";
import { OwnChannelPicker } from "./own-channel-picker";
import { validMonth } from "./month-param";
import { isGraphConfigured } from "@/server/graph/client";
import { getStorageProvider } from "@/server/publish/storage-provider";
import { getChannelsList, getOwnChannel } from "@/server/queries/channels";
import { getCalendarMonth } from "@/server/queries/planned-posts";
import { getScripts } from "@/server/queries/vault";

/** The no-own-channel gate, shared by the Calendar and My reels tabs. */
export async function ownChannelPicker() {
  const channels = await getChannelsList();
  const candidates = channels
    .filter((c) => !c.isOwn)
    .map((c) => ({ id: c.id, handle: c.handle, displayName: c.displayName, followerCount: c.followerCount }));
  return <OwnChannelPicker candidates={candidates} />;
}

/**
 * The Calendar tab: the planner. `planned_posts` needs no Graph connection, so it renders
 * whenever an own channel is marked; only the "published" and "dead air" states wait for
 * a real measurement (see MineCalendar's doc comment).
 */
export async function CalendarTab({ month: monthParam }: { month?: string }) {
  const month = validMonth(monthParam) ?? new Date().toISOString().slice(0, 7);
  if (!(await getOwnChannel())) return ownChannelPicker();

  const [calendar, scripts] = await Promise.all([getCalendarMonth(month), getScripts()]);
  // Publish honesty (publish component): the dialog offers a real publish only when both
  // seams are configured. Mirrors envDefaultsDryRun() in publish-post.ts.
  const bucketConfigured = getStorageProvider() !== null;
  const graphConfigured = isGraphConfigured();
  const publishDryRun = process.env.PUBLISH_DRY_RUN === "1" || (process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production");

  return (
    <MineCalendar
      month={month}
      calendar={calendar}
      scripts={scripts.map((s) => ({ id: s.id, title: s.title }))}
      graphConfigured={graphConfigured}
      bucketConfigured={bucketConfigured}
      dryRun={publishDryRun}
    />
  );
}
