import { z } from "zod";

import { listConnectors, testConnector } from "@/server/connectors/registry";
import { scrubSecrets } from "@/server/connectors/scrub-secrets";
import { errorMessage } from "@/server/lib/action-result";
import { listPlanVersions, PlanRefSchema } from "@/server/services/plan-versions";
import { pullAgain } from "@/server/services/daily-pull";
import { getFunnel } from "@/server/services/funnel";
import { listAgentActions } from "@/server/services/agent-journal";
import { METRIC_LEDGER } from "@/server/metrics/ledger";
import {
  getChannelDetail,
  getChannelMedianHistory,
  getChannelsList,
  getFleets,
  getKanbanBoard,
  getOwnChannel,
} from "@/server/queries/channels";
import { getDashboardStats, getNewFeedOutliers, getStackHealth } from "@/server/queries/dashboard";
import { listCreatorSeeds } from "@/server/queries/discover";
import { getFailureStrip } from "@/server/queries/failure-surface";
import { getFeedBandCounts, getOutlierFeed } from "@/server/queries/feed";
import { getFirstRunGate } from "@/server/queries/first-run-gate";
import {
  getOwnChannelOverview,
  getOwnComments,
  getOwnPostInsightHistory,
  getOwnPosts,
  getOwnReels,
  getReelViewHistory,
} from "@/server/queries/own-channel";
import { getCalendarMonth, getPlannedPostById, getPlannedPosts } from "@/server/queries/planned-posts";
import { getLastRunHealth, getRun, listRuns } from "@/server/queries/runs";
import { getScripts } from "@/server/queries/vault";
import { getVideoDetail } from "@/server/queries/video";
import { removeChannelAction, setOwnChannelAction, unsetOwnChannelAction } from "@/server/actions/channel-actions";
import { followCreatorAction } from "@/server/actions/discover-actions";
import {
  createFleetAction,
  deleteFleetAction,
  moveChannelsAction,
  renameFleetAction,
  reorderFleetsAction,
} from "@/server/actions/fleet-actions";
import { checkGraphTokenAction, measureOwnChannelAction } from "@/server/actions/graph-actions";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { listNotificationsAction, markAllReadAction, markReadAction } from "@/server/actions/notification-actions";
import {
  attachScriptToPlanAction,
  createPlannedPostAction,
  deletePlannedPostAction,
  detachScriptFromPlanAction,
  movePlannedPostAction,
  savePlanEditAction,
  schedulePlannedPostAction,
  setPlanCaptionAction,
  setPlanFieldsAction,
  unschedulePlannedPostAction,
  updatePlannedPostAction,
} from "@/server/actions/planned-post-actions";
import { getSecretStatusAction } from "@/server/actions/secrets-actions";
import {
  addChannelAction,
  cancelSyncAction,
  getChannelSyncProgressAction,
  getLatestSyncJob,
  getSyncProgressAction,
  startSyncAction,
} from "@/server/actions/sync-actions";

export type EngineErrorCode = "unknown_call" | "bad_args" | "failed" | "untrusted_sender";
export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: { code: EngineErrorCode; message: string } };

interface EngineCall<S extends z.ZodType<unknown[]>, R> {
  args: S;
  run: (...args: z.output<S>) => R;
  invoke: (raw: unknown) => Promise<EngineResult<Awaited<R>>>;
}

function call<S extends z.ZodType<unknown[]>, R>(args: S, run: (...args: NoInfer<z.output<S>>) => R): EngineCall<S, R> {
  const invoke = async (raw: unknown): Promise<EngineResult<Awaited<R>>> => {
    const parsed = args.safeParse(raw ?? []);
    if (!parsed.success) return { ok: false, error: { code: "bad_args", message: z.prettifyError(parsed.error) } };
    try {
      return { ok: true, value: scrubFailure(await run(...parsed.data)) };
    } catch (err) {
      return { ok: false, error: { code: "failed", message: scrubSecrets(errorMessage(err)) } };
    }
  };
  return { args, run, invoke };
}

function scrubFailure<T>(value: T): T {
  if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== false) return value;
  if (!("error" in value) || typeof value.error !== "string") return value;
  return { ...value, error: scrubSecrets(value.error) };
}

const none = z.tuple([]);
const id = z.tuple([z.string()]);
const nullableText = z.string().nullable().optional();

const feedFilters = z.object({
  fleetId: z.string().optional(),
  channelId: z.string().optional(),
  platform: z.enum(["instagram", "tiktok", "youtube_shorts"]).optional(),
  minScore: z.number().optional(),
  minViews: z.number().optional(),
  sinceDays: z.number().optional(),
  followerBand: z.enum(["nano", "mid", "macro"]).optional(),
  query: z.string().optional(),
  minEngagement: z.number().optional(),
  analyzed: z.enum(["yes", "no"]).optional(),
});

export const ENGINE_CALLS = {
  getDashboardStats: call(none, getDashboardStats),
  getStackHealth: call(none, getStackHealth),
  getNewFeedOutliers: call(none, getNewFeedOutliers),
  getFailureStrip: call(none, getFailureStrip),
  getFirstRunGate: call(none, getFirstRunGate),

  getChannelsList: call(z.tuple([z.string().optional()]), getChannelsList),
  getKanbanBoard: call(none, getKanbanBoard),
  getOwnChannel: call(none, getOwnChannel),
  getFleets: call(none, getFleets),
  getChannelDetail: call(id, getChannelDetail),
  getChannelMedianHistory: call(z.tuple([z.string(), z.number().int().positive().optional()]), getChannelMedianHistory),
  getOutlierFeed: call(
    z.tuple([feedFilters.extend({ sort: z.enum(["score", "recent", "views"]), limit: z.number().int().min(1).max(200), offset: z.number().int().min(0) })]),
    getOutlierFeed,
  ),
  getFeedBandCounts: call(z.tuple([feedFilters.omit({ followerBand: true }).optional()]), getFeedBandCounts),
  getVideoDetail: call(id, getVideoDetail),
  listCreatorSeeds: call(z.tuple([z.object({ niche: z.string().optional() }).optional()]), listCreatorSeeds),

  getOwnChannelOverview: call(
    z.tuple([z.number().int().positive().optional(), z.object({ offsetDays: z.number().int().min(0).optional() }).optional()]),
    getOwnChannelOverview,
  ),
  getOwnPosts: call(z.tuple([z.object({ limit: z.number().int().positive().optional(), offset: z.number().int().min(0).optional() }).optional()]), getOwnPosts),
  getOwnPostInsightHistory: call(id, getOwnPostInsightHistory),
  getOwnComments: call(none, getOwnComments),
  getOwnReels: call(none, () => getOwnReels()),
  getReelViewHistory: call(none, getReelViewHistory),
  getFunnel: call(z.tuple([z.string().max(64).optional()]), getFunnel),
  getMetricLedger: call(none, () => METRIC_LEDGER),

  getPlannedPosts: call(z.tuple([z.object({ from: z.string(), to: z.string() }).optional()]), getPlannedPosts),
  getPlannedPostById: call(id, getPlannedPostById),
  getCalendarMonth: call(z.tuple([z.string().regex(/^\d{4}-\d{2}$/)]), getCalendarMonth),
  getScripts: call(none, getScripts),
  listPlanVersions: call(
    z.tuple([PlanRefSchema.and(z.object({ version: z.number().int().positive().optional(), limit: z.number().int().min(1).max(50).optional() }))]),
    listPlanVersions,
  ),
  createPlannedPostAction: call(
    z.tuple([
      z.object({
        title: z.string(),
        note: z.string().optional(),
        plannedDate: z.string().optional(),
        plannedTime: z.string().optional(),
        targetLengthSec: z.number().int().positive().optional(),
        scriptId: z.string().optional(),
        sourceVideoId: z.string().optional(),
        videoKind: z.string().optional(),
      }),
    ]),
    createPlannedPostAction,
  ),
  updatePlannedPostAction: call(
    z.tuple([z.string(), z.object({ title: z.string().optional(), note: z.string().optional(), targetLengthSec: z.number().int().positive().nullable().optional(), videoKind: nullableText })]),
    updatePlannedPostAction,
  ),
  savePlanEditAction: call(
    z.tuple([
      z.string(),
      z.object({
        title: z.string().optional(),
        note: z.string().optional(),
        targetLengthSec: z.number().int().positive().nullable().optional(),
        videoKind: nullableText,
        date: nullableText,
        scriptId: nullableText,
        scriptDetachNote: z.string().optional(),
      }),
    ]),
    savePlanEditAction,
  ),
  schedulePlannedPostAction: call(z.tuple([z.string(), z.string(), z.string().optional()]), schedulePlannedPostAction),
  movePlannedPostAction: call(z.tuple([z.string(), z.object({ date: z.string() })]), movePlannedPostAction),
  unschedulePlannedPostAction: call(id, unschedulePlannedPostAction),
  deletePlannedPostAction: call(id, deletePlannedPostAction),
  attachScriptToPlanAction: call(z.tuple([z.string(), z.string()]), attachScriptToPlanAction),
  detachScriptFromPlanAction: call(z.tuple([z.string(), z.string().optional()]), detachScriptFromPlanAction),
  setPlanCaptionAction: call(z.tuple([z.string(), z.string()]), setPlanCaptionAction),
  setPlanFieldsAction: call(z.tuple([z.string(), z.object({ keyword: nullableText, magnetUrl: nullableText })]), setPlanFieldsAction),

  setOwnChannelAction: call(id, setOwnChannelAction),
  unsetOwnChannelAction: call(none, unsetOwnChannelAction),
  removeChannelAction: call(id, removeChannelAction),
  followCreatorAction: call(id, followCreatorAction),
  addChannelAction: call(z.tuple([z.string(), z.object({ requireProfile: z.boolean().optional() }).optional()]), addChannelAction),
  createFleetAction: call(id, createFleetAction),
  renameFleetAction: call(z.tuple([z.string(), z.string()]), renameFleetAction),
  deleteFleetAction: call(id, deleteFleetAction),
  reorderFleetsAction: call(z.tuple([z.array(z.string())]), reorderFleetsAction),
  moveChannelsAction: call(z.tuple([z.array(z.object({ channelId: z.string(), fleetId: z.string().nullable() }))]), moveChannelsAction),

  startSyncAction: call(z.tuple([z.array(z.string()).optional()]), startSyncAction),
  cancelSyncAction: call(id, cancelSyncAction),
  getSyncProgressAction: call(z.tuple([z.string().nullable().optional()]), getSyncProgressAction),
  getChannelSyncProgressAction: call(id, getChannelSyncProgressAction),
  getLatestSyncJob: call(none, getLatestSyncJob),
  measureOwnChannelAction: call(none, measureOwnChannelAction),
  checkGraphTokenAction: call(none, checkGraphTokenAction),
  getIgStatusAction: call(none, getIgStatusAction),
  listRuns: call(z.tuple([z.number().int().positive().optional()]), listRuns),
  getRun: call(id, getRun),
  getLastRunHealth: call(none, getLastRunHealth),

  getSecretStatusAction: call(none, getSecretStatusAction),
  listConnectors: call(none, () => listConnectors()),
  testConnector: call(id, (connectorId) => testConnector(connectorId)),
  pullAgain: call(id, (connectorId) => pullAgain(connectorId)),

  listNotificationsAction: call(none, listNotificationsAction),
  markReadAction: call(z.tuple([z.number().int()]), markReadAction),
  markAllReadAction: call(none, markAllReadAction),

  listAgentActions: call(z.tuple([z.number().int().min(1).max(500).optional()]), listAgentActions),
};

export type EngineCalls = typeof ENGINE_CALLS;
export type EngineCallName = keyof EngineCalls;
export type EngineCallArgs<N extends EngineCallName> = z.input<EngineCalls[N]["args"]>;
export type EngineCallValue<N extends EngineCallName> = Awaited<ReturnType<EngineCalls[N]["run"]>>;

function isEngineCallName(name: unknown): name is EngineCallName {
  return typeof name === "string" && Object.hasOwn(ENGINE_CALLS, name);
}

export async function dispatchEngineCall(name: unknown, args: unknown): Promise<EngineResult<unknown>> {
  if (!isEngineCallName(name)) return { ok: false, error: { code: "unknown_call", message: `no engine call named ${String(name)}` } };
  return ENGINE_CALLS[name].invoke(args);
}
