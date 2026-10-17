import { inArray, isNotNull, and } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { isGraphConfigured } from "@/server/graph/client";
import { getStorageProvider } from "@/server/publish/storage-provider";
import { getPlannedPosts } from "@/server/queries/planned-posts";
import { listRuns } from "@/server/queries/runs";
import { getVaultItems } from "@/server/queries/vault";
import { getRemixSession } from "@/server/services/remix";
import { FUNNEL_METRICS, getFunnel } from "@/server/services/funnel";
import { listPlanVersions } from "@/server/services/plan-versions";
import { GraphTokenLine } from "@/components/status/graph-token-line";
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

  const hooks: Record<string, string | null> = {};
  const hookTopics: Record<string, string | null> = {};
  for (const id of new Set(plans.flatMap((p) => (p.remixSessionId ? [p.remixSessionId] : [])))) {
    const session = await getRemixSession(id);
    if (session) {
      hooks[id] = session.chosenHook;
      hookTopics[id] = session.topic;
    }
  }

  const sourceIds = plans.flatMap((p) => (p.sourceVideoId ? [p.sourceVideoId] : []));
  const gone = sourceIds.length
    ? new Set(
        db
          .select({ id: tables.videos.id })
          .from(tables.videos)
          .where(and(inArray(tables.videos.id, sourceIds), isNotNull(tables.videos.deletedAt)))
          .all()
          .map((v) => v.id)
      )
    : new Set<string>();
  const sourceGone = plans.filter((p) => p.sourceVideoId && gone.has(p.sourceVideoId)).map((p) => p.id);

  const hookTemplates = (await getVaultItems("hook")).map((t) => ({ id: t.id, title: t.title, text: t.templateText }));

  const dryRun = process.env.PUBLISH_DRY_RUN === "1" || (process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production");

  return (
    <>
      <GraphTokenLine />
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
        hooks={hooks}
        hookTopics={hookTopics}
        sourceGone={sourceGone}
        hookTemplates={hookTemplates}
        runs={listRuns(5)}
      />
    </>
  );
}
