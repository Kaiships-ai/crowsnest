import { isGraphConfigured } from "@/server/graph/client";
import { getStorageProvider } from "@/server/publish/storage-provider";
import { getPlannedPosts } from "@/server/queries/planned-posts";
import { FUNNEL_METRICS, getFunnel } from "@/server/services/funnel";
import { listPlanVersions } from "@/server/services/plan-versions";
import { WeekScreen } from "./week-screen";
import { isoWeekKey, weekDays, type DraftVersion, type FunnelCell } from "./week-model";

const METRICS = Object.entries(FUNNEL_METRICS).flatMap(([source, ms]) => ms.map((metric) => ({ source, metric })));

/** Tuần này, the landing screen: this ISO week's dated plans, the week's plan versions,
 *  and the latest funnel numbers per reel keyword. "Today" is the server's local date. */
export async function WeekTab() {
  const today = new Date().toLocaleDateString("sv-SE");
  const days = weekDays(today);
  const weekKey = isoWeekKey(today);
  const plans = (await getPlannedPosts({ from: days[0], to: days[6] })).filter((p) => p.plannedDate !== null);

  const funnel: Record<string, FunnelCell[]> = {};
  const keywords = new Set(plans.flatMap((p) => (p.keyword ? [p.keyword.toLowerCase()] : [])));
  for (const f of getFunnel()) {
    const k = f.keyword.toLowerCase();
    if (keywords.has(k)) (funnel[k] ??= []).push({ source: f.source, metric: f.metric, value: f.value, capturedAt: f.capturedAt });
  }

  const listed = listPlanVersions({ period: "week", periodKey: weekKey, limit: 50 });
  const versions = listed.ok ? listed.versions : [];
  const live = versions.find((v) => v.status === "live") ?? null;
  const newest = versions[0];
  const draft: DraftVersion | null =
    newest && newest.status === "proposed" && (!live || newest.version > live.version) ? { id: newest.id, version: newest.version, diff: newest.diff } : null;

  const dryRun = process.env.PUBLISH_DRY_RUN === "1" || (process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production");

  return (
    <WeekScreen
      today={today}
      weekKey={weekKey}
      liveVersion={live?.version ?? null}
      draft={draft}
      reels={plans}
      funnel={funnel}
      metrics={METRICS}
      graphConfigured={isGraphConfigured()}
      bucketConfigured={getStorageProvider() !== null}
      dryRun={dryRun}
    />
  );
}
