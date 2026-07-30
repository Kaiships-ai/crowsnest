import { desc, eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { getLlm, type LlmClient } from "@/server/llm/client";
import { HookOptionsSchema, OutlineSchema, type Outline, type VideoAnalysis } from "@/server/llm/schemas";
import { getSimilarOutliers } from "./similar";
import { rowToAnalysis } from "./analyze";
import { HOOK_SYSTEM, OUTLINE_SYSTEM, SCRIPT_SYSTEM, buildHookUser, buildOutlineUser, buildScriptUser } from "./prompts/remix-prompts";

export type RemixStage = "prompt" | "research" | "hook" | "style" | "script";

export interface ResearchSimilarItem {
  videoId: string;
  channelHandle: string;
  caption: string | null;
  outlierScore: number | null;
}

export interface ResearchNotes {
  sourceAnalysis: VideoAnalysis | null;
  transcriptExcerpt: string | null;
  similar: ResearchSimilarItem[];
  facts: string;
}

export interface RemixSessionRow {
  id: string;
  sourceVideoId: string;
  stage: RemixStage;
  topic: string | null;
  niche: string | null;
  targetLengthSec: number | null;
  researchNotes: ResearchNotes | null;
  hookOptions: string[] | null;
  chosenHook: string | null;
  styleVaultItemId: string | null;
  outline: Outline | null;
  variants: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface StagePatch {
  topic: string;
  niche: string;
  targetLengthSec: number;
  chosenHook: string;
  // Nullable (unlike the plan's original `string`): the Style stage's Vault-style
  // Select must be able to revert to "use the source video's own structure", which
  // clears this back to null — a plain optional string can't distinguish "clear it"
  // from "leave it alone" the way `Partial<StagePatch>` already does for every field.
  styleVaultItemId: string | null;
  stage: RemixStage;
  // All three additive beyond the plan's original field list, surfaced by building
  // the Task 6 UI: the Research stage's facts box, the Style stage's editable outline
  // beats, and the Script stage's per-variant edit/regenerate all need to persist
  // hand-edits after their initial generation, and researchNotes/outline/variants are
  // real columns on this table — reusing updateStage's existing generic
  // `.set({...patch})` rather than adding three bespoke setter functions.
  researchNotes: ResearchNotes;
  outline: Outline;
  variants: string[];
}

const DEFAULT_TARGET_LENGTH_SEC = 45;
const DEFAULT_VARIANT_COUNT = 3;
const TRANSCRIPT_EXCERPT_CHARS = 500;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Writes one `remix_runs` row (v1-scope.md, Remix studio P0: "remix_sessions records
 * no per-run history... without it a failed generation leaves no trace, and this
 * pipeline fails often"). The only writer of that table — `queries/remix-runs.ts` is
 * read only, matching contract 2's "the write is the engine's own bookkeeping, not a
 * user action" pattern for `sync_channel_runs`.
 *
 * Called from inside each generation function's own try/catch so a run row is written
 * on both outcomes, never only on success — a run log that only records what worked
 * would defeat the reason this table exists.
 */
async function recordRun(o: { sessionId: string; stage: RemixStage; startedAt: string; startedAtMs: number; outcome: "success" | "error"; detail: string }): Promise<void> {
  await db.insert(tables.remixRuns).values({
    id: newId(),
    sessionId: o.sessionId,
    stage: o.stage,
    outcome: o.outcome,
    startedAt: o.startedAt,
    finishedAt: nowIso(),
    elapsedMs: Date.now() - o.startedAtMs,
    detail: o.detail,
    errorMessage: o.outcome === "error" ? o.detail : null,
  });
}

function parseOutline(raw: string | null): Outline | null {
  if (!raw) return null;
  try {
    return OutlineSchema.parse(JSON.parse(raw));
  } catch {
    return null; // malformed/legacy data — treat as "no outline yet" rather than crash
  }
}

function toSessionRow(row: typeof tables.remixSessions.$inferSelect): RemixSessionRow {
  return {
    id: row.id,
    sourceVideoId: row.sourceVideoId,
    stage: row.stage as RemixStage,
    topic: row.topic,
    niche: row.niche,
    targetLengthSec: row.targetLengthSec,
    researchNotes: (row.researchNotes as ResearchNotes | null) ?? null,
    hookOptions: row.hookOptions,
    chosenHook: row.chosenHook,
    styleVaultItemId: row.styleVaultItemId,
    outline: parseOutline(row.outline),
    variants: row.variants,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getRawSession(id: string) {
  const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, id)).limit(1);
  if (!row) throw new Error(`Remix session not found: ${id}`);
  return row;
}

async function getSession(id: string): Promise<RemixSessionRow> {
  return toSessionRow(await getRawSession(id));
}

async function getVideoRow(videoId: string) {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  return row ?? null;
}

async function getAnalysis(videoId: string): Promise<VideoAnalysis | null> {
  const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
  if (!row) return null;
  // Strips the Layout section's provenance columns (contract 5) back off: the prompt
  // builders below only ever read hookType/structureSegments/formatTags/styleTags/
  // whyItWorked, and `researchNotes.sourceAnalysis` is typed and persisted as plain
  // `VideoAnalysis` — layout has no business riding along into a remix prompt or a
  // stored research note.
  const { hookType, structureSegments, formatTags, styleTags, whyItWorked } = rowToAnalysis(row);
  return { hookType, structureSegments, formatTags, styleTags, whyItWorked };
}

async function getVaultItemTemplateText(vaultItemId: string): Promise<string | null> {
  const [row] = await db.select({ templateText: tables.vaultItems.templateText }).from(tables.vaultItems).where(eq(tables.vaultItems.id, vaultItemId)).limit(1);
  return row?.templateText ?? null;
}

// Exported for the Prompt stage's read-only niche chip (Task 6) — the same lookup
// the service uses internally for prompt-building, so the UI display never drifts
// from what's actually sent to Claude.
export async function getNicheProfile(): Promise<string> {
  const [row] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, "niche_profile")).limit(1);
  return row?.value ?? "general short-form content";
}

function describeSourceHookPattern(analysis: VideoAnalysis | null): string {
  return analysis?.hookType || "curiosity-gap";
}

function describeSourceStructure(analysis: VideoAnalysis | null): string {
  if (!analysis || analysis.structureSegments.length === 0) {
    return "No source structure available — use a natural hook / build / payoff / CTA structure.";
  }
  return analysis.structureSegments.map((segment) => `${segment.label} (${segment.startSec}-${segment.endSec}s): ${segment.note}`).join("; ");
}

/**
 * Reuses the latest remix session for this source video if one exists (any stage —
 * "resume where you left off" is the intended UX), else creates a fresh one at stage
 * "prompt". Mirrors analyze.ts's getOrCreateAnalysis cache-or-create shape (Task 2).
 */
export async function getOrCreateSession(videoId: string): Promise<RemixSessionRow> {
  const [existing] = await db
    .select()
    .from(tables.remixSessions)
    .where(eq(tables.remixSessions.sourceVideoId, videoId))
    .orderBy(desc(tables.remixSessions.updatedAt))
    .limit(1);
  if (existing) return toSessionRow(existing);

  const id = newId();
  const now = nowIso();
  await db.insert(tables.remixSessions).values({ id, sourceVideoId: videoId, stage: "prompt", createdAt: now, updatedAt: now });
  return toSessionRow(await getRawSession(id));
}

/** Persists whichever StagePatch fields are given — topic/niche/targetLengthSec/
 * chosenHook/styleVaultItemId/stage — on every stage move through the studio. */
export async function updateStage(id: string, patch: Partial<StagePatch>): Promise<void> {
  const { researchNotes, outline, ...rest } = patch;
  await db
    .update(tables.remixSessions)
    .set({
      ...rest,
      ...(researchNotes !== undefined ? { researchNotes: researchNotes as unknown as Record<string, unknown> } : {}),
      ...(outline !== undefined ? { outline: JSON.stringify(outline) } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(tables.remixSessions.id, id));
}

/**
 * Assembles the Research stage's starting point: source analysis + a transcript
 * excerpt + the top-5 similar tracked outliers (via services/similar.ts) + an empty
 * facts box for the user to fill in by hand. Makes NO Claude calls — this is pure
 * local assembly, persisted straight to `researchNotes`.
 */
export async function buildResearch(id: string): Promise<ResearchNotes> {
  const session = await getSession(id);

  const sourceAnalysis = await getAnalysis(session.sourceVideoId);

  const [transcriptRow] = await db
    .select({ text: tables.transcripts.text })
    .from(tables.transcripts)
    .where(eq(tables.transcripts.videoId, session.sourceVideoId))
    .limit(1);
  const transcriptExcerpt = transcriptRow
    ? transcriptRow.text.length > TRANSCRIPT_EXCERPT_CHARS
      ? `${transcriptRow.text.slice(0, TRANSCRIPT_EXCERPT_CHARS)}…`
      : transcriptRow.text
    : null;

  const similarOutliers = await getSimilarOutliers(session.sourceVideoId, 5);
  const similar: ResearchSimilarItem[] = similarOutliers.map((item) => ({
    videoId: item.videoId,
    channelHandle: item.channel.handle,
    caption: item.caption,
    outlierScore: item.outlierScore,
  }));

  const notes: ResearchNotes = { sourceAnalysis, transcriptExcerpt, similar, facts: "" };

  await db
    .update(tables.remixSessions)
    .set({ researchNotes: notes as unknown as Record<string, unknown>, updatedAt: nowIso() })
    .where(eq(tables.remixSessions.id, id));

  return notes;
}

/**
 * One Claude call -> HookOptionsSchema (5 hooks). Template comes from a chosen Vault
 * hook item if `opts.vaultItemId` is given, else falls back to the source video's own
 * hookType. Persists the result to `hookOptions`.
 */
export async function generateHooks(id: string, opts?: { vaultItemId?: string; llm?: LlmClient }): Promise<string[]> {
  const session = await getSession(id);
  const startedAt = nowIso();
  const startedAtMs = Date.now();

  try {
    const video = await getVideoRow(session.sourceVideoId);
    const analysis = await getAnalysis(session.sourceVideoId);

    const pattern = opts?.vaultItemId
      ? (await getVaultItemTemplateText(opts.vaultItemId)) ?? describeSourceHookPattern(analysis)
      : describeSourceHookPattern(analysis);

    const client = opts?.llm ?? getLlm();
    const niche = await getNicheProfile();
    const topic = session.topic ?? video?.caption ?? "this topic";
    const facts = session.researchNotes?.facts || undefined;

    const result = await client.generateParsed({
      system: HOOK_SYSTEM,
      user: buildHookUser({ topic, niche, pattern, facts }),
      schema: HookOptionsSchema,
    });

    await db
      .update(tables.remixSessions)
      .set({ hookOptions: result.hooks, updatedAt: nowIso() })
      .where(eq(tables.remixSessions.id, id));

    await recordRun({ sessionId: id, stage: "hook", startedAt, startedAtMs, outcome: "success", detail: `${result.hooks.length} hooks generated` });
    return result.hooks;
  } catch (err) {
    // The previous hookOptions column is untouched — nothing above writes to it until
    // generateParsed has already succeeded — so a failure here leaves the prior hook
    // list intact, per the acceptance criteria, and only appends this row.
    await recordRun({ sessionId: id, stage: "hook", startedAt, startedAtMs, outcome: "error", detail: errorMessage(err) });
    throw err;
  }
}

/**
 * One Claude call -> OutlineSchema. Structure comes from the session's chosen Vault
 * style item if `styleVaultItemId` is set, else the source video's own structure
 * segments. Persists the result (JSON-stringified — `outline` is a plain text column).
 */
export async function generateOutline(id: string, opts?: { llm?: LlmClient }): Promise<Outline> {
  const session = await getSession(id);
  const startedAt = nowIso();
  const startedAtMs = Date.now();

  try {
    const video = await getVideoRow(session.sourceVideoId);
    const analysis = await getAnalysis(session.sourceVideoId);

    const structure = session.styleVaultItemId
      ? (await getVaultItemTemplateText(session.styleVaultItemId)) ?? describeSourceStructure(analysis)
      : describeSourceStructure(analysis);

    const client = opts?.llm ?? getLlm();
    const niche = await getNicheProfile();
    const topic = session.topic ?? video?.caption ?? "this topic";
    const targetLengthSec = session.targetLengthSec ?? DEFAULT_TARGET_LENGTH_SEC;
    const facts = session.researchNotes?.facts || undefined;

    const outline = await client.generateParsed({
      system: OUTLINE_SYSTEM,
      user: buildOutlineUser({ topic, niche, hook: session.chosenHook ?? "", targetLengthSec, structure, facts }),
      schema: OutlineSchema,
    });

    await db
      .update(tables.remixSessions)
      .set({ outline: JSON.stringify(outline), updatedAt: nowIso() })
      .where(eq(tables.remixSessions.id, id));

    await recordRun({ sessionId: id, stage: "style", startedAt, startedAtMs, outcome: "success", detail: `outline generated (${outline.beats.length} beats)` });
    return outline;
  } catch (err) {
    await recordRun({ sessionId: id, stage: "style", startedAt, startedAtMs, outcome: "error", detail: errorMessage(err) });
    throw err;
  }
}

/**
 * Generates `count` (default 3) script variants in parallel via Promise.allSettled —
 * a rejected variant becomes `{ error }` at its own index while the rest are
 * unaffected (per-variant isolation, DESIGN.md §6).
 *
 * Two persistence modes, both leaving a failed variant with no trace in the DB
 * (matching the plan's "retry that one variant" UX, Task 6, rather than storing a
 * placeholder):
 *  - `opts.index` unset (the normal "Write script" / "Regenerate all" call): exactly
 *    `count` variants are generated and the *whole* `variants[]` column is replaced
 *    with whichever succeeded.
 *  - `opts.index` set (a single-variant "Regenerate", review finding M2): exactly one
 *    variant is generated and, on success, read-modify-written into the existing
 *    persisted `variants[]` at that one slot — every other slot (including one being
 *    autosaved concurrently from a manual edit elsewhere) is left untouched. On
 *    failure the DB is not written at all, so the previous value at that slot survives.
 */
export async function generateVariants(
  id: string,
  opts?: { count?: number; index?: number; llm?: LlmClient }
): Promise<(string | { error: string })[]> {
  const session = await getSession(id);
  const startedAt = nowIso();
  const startedAtMs = Date.now();
  const video = await getVideoRow(session.sourceVideoId);
  const count = opts?.index !== undefined ? 1 : (opts?.count ?? DEFAULT_VARIANT_COUNT);
  const client = opts?.llm ?? getLlm();
  const niche = await getNicheProfile();
  const facts = session.researchNotes?.facts || undefined;
  const similar = session.researchNotes?.similar?.length
    ? session.researchNotes.similar.map((item) => `${item.channelHandle}${item.caption ? ` — ${item.caption}` : ""}`)
    : undefined;

  const user = buildScriptUser({
    topic: session.topic ?? video?.caption ?? "this topic",
    niche,
    hook: session.chosenHook ?? "",
    outline: session.outline ?? { beats: [] },
    targetLengthSec: session.targetLengthSec ?? DEFAULT_TARGET_LENGTH_SEC,
    facts,
    similar,
  });

  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => client.generateText({ system: SCRIPT_SYSTEM, user }))
  );

  const results: (string | { error: string })[] = settled.map((outcome) =>
    outcome.status === "fulfilled" ? outcome.value : { error: errorMessage(outcome.reason) }
  );
  const successCount = results.filter((r) => typeof r === "string").length;

  // Per-variant isolation means this call itself essentially never throws — a failed
  // variant becomes `{ error }` at its own index instead. The run log still needs a run
  // row on every call, so the "outcome" here is a judgment on the RESULT rather than on
  // whether the call raised: zero successes out of however many were asked for is the
  // same "this attempt didn't work" fact a caller of generateHooks/generateOutline gets
  // from a thrown error, and it must not go unrecorded just because the mechanism here
  // happens to be per-item rather than a single rejected promise.
  const runOutcome: "success" | "error" = successCount > 0 ? "success" : "error";
  const runDetail =
    opts?.index !== undefined
      ? typeof results[0] === "string"
        ? `variant ${opts.index + 1} regenerated`
        : `variant ${opts.index + 1} failed: ${(results[0] as { error: string }).error}`
      : `${successCount} of ${count} variants succeeded`;

  if (opts?.index !== undefined) {
    const [result] = results;
    if (typeof result === "string") {
      const merged = [...(session.variants ?? [])];
      merged[opts.index] = result;
      await db
        .update(tables.remixSessions)
        .set({ variants: merged, updatedAt: nowIso() })
        .where(eq(tables.remixSessions.id, id));
    }
    await recordRun({ sessionId: id, stage: "script", startedAt, startedAtMs, outcome: runOutcome, detail: runDetail });
    return results;
  }

  const successes = results.filter((result): result is string => typeof result === "string");
  await db
    .update(tables.remixSessions)
    .set({ variants: successes, updatedAt: nowIso() })
    .where(eq(tables.remixSessions.id, id));

  await recordRun({ sessionId: id, stage: "script", startedAt, startedAtMs, outcome: runOutcome, detail: runDetail });
  return results;
}

/**
 * Writes a finished script to the `scripts` table, linked to its source video and
 * (if the session has one) its style Vault item. `hookVaultItemId` is always null:
 * `remix_sessions.chosenHook` stores the picked hook's raw text, not a vault_items.id
 * — there is no column tracking which Vault hook (if any) seeded the generation that
 * produced it, so there is nothing valid to link here without a schema change.
 *
 * `remixSessionId` is set to this session's id (V1 data contracts, contract 6) — the
 * planner's load-bearing link. The session itself is disposable working state (stage,
 * hook options, variants) and can be deleted without cost: `content` above is already
 * a COPY of the finished text, not a reference, so the script (and any planned post
 * carrying it) keeps everything that matters when the session is gone. Only the
 * "which run made this" provenance line is lost, via the column's `set null` FK.
 */
export async function saveScript(id: string, content: string, title: string): Promise<{ scriptId: string }> {
  const session = await getSession(id);
  const scriptId = newId();
  const now = nowIso();

  await db.insert(tables.scripts).values({
    id: scriptId,
    title,
    content,
    sourceVideoId: session.sourceVideoId,
    hookVaultItemId: null,
    styleVaultItemId: session.styleVaultItemId,
    remixSessionId: id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  return { scriptId };
}

/**
 * The <60s "Quick Remix" path (DESIGN.md §2.5): research -> hooks (auto-picking the
 * first option) -> outline -> variants, sequentially, ending at stage "script" with
 * every field populated so the studio can land directly on the Script stage while
 * every earlier stage stays reachable and editable via the stepper.
 */
export async function quickRemix(id: string, llm?: LlmClient): Promise<void> {
  await buildResearch(id);
  await updateStage(id, { stage: "research" });

  const hooks = await generateHooks(id, { llm });
  await updateStage(id, { chosenHook: hooks[0] ?? "", stage: "hook" });

  await updateStage(id, { stage: "style" });
  await generateOutline(id, { llm });

  await generateVariants(id, { llm });
  await updateStage(id, { stage: "script" });
}
