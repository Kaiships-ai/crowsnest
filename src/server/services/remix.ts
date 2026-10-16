import { desc, eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { OutlineSchema, type Outline, type StoredAnalysisFields } from "@/server/schemas";
import { getSimilarOutliers } from "./similar";
import { rowToAnalysis } from "./analyze";
import { getPersona, type Persona } from "./persona";
import { deriveScriptTitle } from "@/lib/script-title";
import { HOOK_SYSTEM, OUTLINE_SYSTEM, SCRIPT_SYSTEM, buildHookUser, buildOutlineUser, buildScriptUser } from "./prompts/remix-prompts";

export type RemixStage = "prompt" | "research" | "hook" | "style" | "script" | "finish";

export interface ResearchSimilarItem {
  videoId: string;
  channelHandle: string;
  caption: string | null;
  outlierScore: number | null;
}

export interface ResearchNotes {
  sourceAnalysis: StoredAnalysisFields | null;
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
  /** Index into `variants` of the variant the user picked. Null means no pick yet. */
  chosenVariantIndex: number | null;
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
  hookOptions: string[];
  /** Nullable for the same reason `styleVaultItemId` is: the user must be able to
   *  un-pick, and `Partial<StagePatch>` already distinguishes "clear it" from "leave
   *  it alone". */
  chosenVariantIndex: number | null;
}

const DEFAULT_TARGET_LENGTH_SEC = 45;
const TRANSCRIPT_EXCERPT_CHARS = 500;

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
    chosenVariantIndex: row.chosenVariantIndex,
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

/** The session row by id, or null when there is none. Exported for the remix-scoped
 *  prompt builder (export.ts), which reads the session rather than the source video.
 *  Unlike the internal `getSession` it does not throw on a missing id: a builder asked
 *  about a session that no longer exists should return null, not blow up an action. */
export async function getRemixSession(id: string): Promise<RemixSessionRow | null> {
  const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, id)).limit(1);
  return row ? toSessionRow(row) : null;
}

async function getVideoRow(videoId: string) {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  return row ?? null;
}

async function getAnalysis(videoId: string): Promise<StoredAnalysisFields | null> {
  const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
  if (!row) return null;
  // Strips the Layout section's provenance columns (contract 5) back off: the prompt
  // builders below only ever read hookType/structureSegments/formatTags/styleTags/
  // whyItWorked, and `researchNotes.sourceAnalysis` is typed and persisted as plain
  // `StoredAnalysisFields` — layout has no business riding along into a remix prompt or a
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

function describeSourceHookPattern(analysis: StoredAnalysisFields | null): string {
  return analysis?.hookType || "curiosity-gap";
}

function describeSourceStructure(analysis: StoredAnalysisFields | null): string {
  if (!analysis || analysis.structureSegments.length === 0) {
    return "No source structure available — use a natural hook / build / payoff / CTA structure.";
  }
  return analysis.structureSegments
    .map((segment) => {
      const base = `${segment.label} (${segment.startSec}-${segment.endSec}s): ${segment.note}`;
      // Anti-fabrication: `transcript` is only appended when it was actually captured
      // (undefined on a beat analyzed before that field shipped) — never a placeholder.
      return segment.transcript ? `${base} (said: ${segment.transcript})` : base;
    })
    .join("; ");
}

const VARIANT_ANGLES = [
  "stay close to the source structure and pacing",
  "open from a different hook angle",
  "tighten the pacing, cut the setup",
];

/**
 * Reuses the latest remix session for this source video if one exists (any stage —
 * "resume where you left off" is the intended UX), else creates a fresh one at stage
 * "prompt". Mirrors the cache-or-create shape analyze.ts's saveAgentAnalysis/rowToAnalysis
 * pair uses for a video_analyses row (Task 2).
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
 * chosenHook/styleVaultItemId/stage — on every stage move through the remix studio. */
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
 * Appends the Persona's audience/voice/do/don't (Task 5's `getPersona()`) onto an
 * already-built prompt `user` string. A post-processing step here rather than a new
 * parameter on each `build*User()` in `prompts/remix-prompts.ts`: this task's scope is
 * `remix.ts` only, and those builders' plain-string, framework-free contract is worth
 * keeping small. Each line is omitted when its field is empty, same as the builders'
 * own optional `facts` line, so a persona nobody has filled in yet changes nothing about
 * the prompt.
 */
function withPersona(user: string, persona: Persona): string {
  const lines: string[] = [];
  if (persona.audience) lines.push(`Audience: ${persona.audience}`);
  if (persona.voice) lines.push(`Voice: ${persona.voice}`);
  if (persona.do) lines.push(`Do: ${persona.do}`);
  if (persona.dont) lines.push(`Don't: ${persona.dont}`);
  return lines.length > 0 ? `${user}\n${lines.join("\n")}` : user;
}

/** A stage's assembled prompt, for a caller that fulfills it itself instead of asking
 *  crowsnest to call an internal model — the keyless MCP remix path (P0 slice 2b).
 *  `context` carries whatever structured bits that caller needs beyond the raw text. */
export interface RemixPrompt {
  system: string;
  user: string;
  context: Record<string, unknown>;
}

/**
 * Assembles the Hooks stage prompt (source hook pattern, niche, persona, facts, opening
 * line, steer). Makes no model call. The caller writes hooks itself and reports
 * its pick via `crowsnest_remix_choose_hook`.
 */
export async function buildHookPrompt(id: string, opts?: { vaultItemId?: string; steer?: string }): Promise<RemixPrompt> {
  const session = await getSession(id);
  const video = await getVideoRow(session.sourceVideoId);
  const analysis = await getAnalysis(session.sourceVideoId);

  const pattern = opts?.vaultItemId
    ? (await getVaultItemTemplateText(opts.vaultItemId)) ?? describeSourceHookPattern(analysis)
    : describeSourceHookPattern(analysis);

  const niche = await getNicheProfile();
  const persona = await getPersona();
  const topic = session.topic ?? video?.caption ?? "this topic";
  const facts = session.researchNotes?.facts || undefined;
  const openingLine = analysis?.structureSegments[0]?.transcript;

  const user = withPersona(
    buildHookUser({ topic, niche, pattern, facts, whyItWorked: analysis?.whyItWorked, openingLine, steer: opts?.steer }),
    persona
  );

  return { system: HOOK_SYSTEM, user, context: { topic, niche, pattern } };
}

/**
 * Assembles the Outline stage prompt (chosen structure, hook, target length, persona, facts, steer). Makes no model call.
 * The caller writes the outline itself and reports it back via the Script stage.
 */
export async function buildOutlinePrompt(id: string, opts?: { steer?: string }): Promise<RemixPrompt> {
  const session = await getSession(id);
  const video = await getVideoRow(session.sourceVideoId);
  const analysis = await getAnalysis(session.sourceVideoId);

  const structure = session.styleVaultItemId
    ? (await getVaultItemTemplateText(session.styleVaultItemId)) ?? describeSourceStructure(analysis)
    : describeSourceStructure(analysis);

  const niche = await getNicheProfile();
  const persona = await getPersona();
  const topic = session.topic ?? video?.caption ?? "this topic";
  const targetLengthSec = session.targetLengthSec ?? DEFAULT_TARGET_LENGTH_SEC;
  const facts = session.researchNotes?.facts || undefined;

  const user = withPersona(
    buildOutlineUser({ topic, niche, hook: session.chosenHook ?? "", targetLengthSec, structure, facts, whyItWorked: analysis?.whyItWorked, steer: opts?.steer }),
    persona
  );

  return { system: OUTLINE_SYSTEM, user, context: { topic, niche, hook: session.chosenHook ?? "", targetLengthSec, structure } };
}

/**
 * Assembles the Script stage prompt (hook, outline, persona, facts, similar outliers,
 * source beats, steer). `context.angles` carries `VARIANT_ANGLES`, so a caller wanting
 * more than one take can append each angle to `user` itself. Makes no
 * model call. The caller writes the script itself and saves it via
 * `crowsnest_remix_save_script`.
 */
export async function buildScriptPrompt(id: string, opts?: { steer?: string }): Promise<RemixPrompt> {
  const session = await getSession(id);
  const video = await getVideoRow(session.sourceVideoId);
  const analysis = await getAnalysis(session.sourceVideoId);

  const niche = await getNicheProfile();
  const persona = await getPersona();
  const facts = session.researchNotes?.facts || undefined;
  const similar = session.researchNotes?.similar?.length
    ? session.researchNotes.similar.map((item) => `${item.channelHandle}${item.caption ? ` — ${item.caption}` : ""}`)
    : undefined;

  const baseUser = buildScriptUser({
    topic: session.topic ?? video?.caption ?? "this topic",
    niche,
    hook: session.chosenHook ?? "",
    outline: session.outline ?? { beats: [] },
    targetLengthSec: session.targetLengthSec ?? DEFAULT_TARGET_LENGTH_SEC,
    facts,
    similar,
    sourceBeats: analysis?.structureSegments,
    whyItWorked: analysis?.whyItWorked,
    steer: opts?.steer,
  });

  const user = withPersona(baseUser, persona);

  return { system: SCRIPT_SYSTEM, user, context: { angles: VARIANT_ANGLES } };
}

/**
 * The agent's script save (crowsnest_remix_save_script). It appends the script as a variant
 * and picks it, so the studio's Script and Finish stages show the words the agent saved,
 * not an older variant.
 */
export async function saveAgentScript(id: string, content: string, title: string): Promise<{ scriptId: string }> {
  const session = await getSession(id);
  const variants = [...(session.variants ?? []), content];
  await updateStage(id, { variants });
  return saveScript(id, content, title, variants.length - 1);
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
export async function saveScript(
  id: string,
  content: string,
  title: string,
  variantIndex?: number
): Promise<{ scriptId: string }> {
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

  // Saving IS the pick. Recorded here, alongside the script row, so the remix prompt
  // (buildRemixPrompt) and the post brief read the variant the user actually chose
  // rather than falling back to variants[0], which would put words in front of them
  // that they never selected.
  if (variantIndex !== undefined) {
    await updateStage(id, { chosenVariantIndex: variantIndex });
  }

  return { scriptId };
}

export interface RemixFinishResult {
  /** The planned post whose studio the finish view opens. */
  postId: string;
  /** True when this call created the plan, false when it reused one already linked. */
  created: boolean;
  /** The script the plan carries, when one has been saved from this session. */
  scriptId: string | null;
}

/**
 * Makes sure the scripts row a session's plan would carry matches the session's CURRENT
 * chosen variant (`variants[chosenVariantIndex]`), and returns it.
 *
 * Without this, the "latest saved script" and "the variant the user has open right now"
 * can diverge two ways: the user saves, then regenerates or re-picks without saving
 * again (the latest script row is now stale text), or the plan already exists and was
 * never told a later save happened at all. Both leave `planned_posts.script_id` pointing
 * at words the user never chose, even though the post brief (which reads the session
 * directly, not this column) already shows the right ones.
 *
 * Anti-fabrication: with no chosen variant yet, this returns the latest saved script
 * untouched rather than inventing one — a finish with nothing picked must behave exactly
 * as before.
 *
 * Idempotent by construction: a script row whose content already equals the chosen
 * variant (the latest one, or any earlier one the user saved and has now picked again)
 * is reused rather than re-inserted, so repeated calls with nothing changed create
 * nothing new.
 */
async function reconcileAttachedScript(session: RemixSessionRow): Promise<{ id: string; title: string } | null> {
  const scriptRows = await db
    .select({ id: tables.scripts.id, title: tables.scripts.title, content: tables.scripts.content })
    .from(tables.scripts)
    .where(eq(tables.scripts.remixSessionId, session.id))
    .orderBy(desc(tables.scripts.createdAt));

  const latest = scriptRows[0] ?? null;
  const chosenText = session.chosenVariantIndex !== null ? (session.variants?.[session.chosenVariantIndex] ?? null) : null;

  if (chosenText === null) return latest ? { id: latest.id, title: latest.title } : null;
  if (latest && latest.content === chosenText) return { id: latest.id, title: latest.title };

  const match = scriptRows.find((row) => row.content === chosenText);
  if (match) return { id: match.id, title: match.title };

  const scriptId = newId();
  const now = nowIso();
  const title = latest?.title ?? deriveScriptTitle(session.topic);
  await db.insert(tables.scripts).values({
    id: scriptId,
    title,
    content: chosenText,
    sourceVideoId: session.sourceVideoId,
    hookVaultItemId: null,
    styleVaultItemId: session.styleVaultItemId,
    remixSessionId: session.id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  return { id: scriptId, title };
}

/**
 * The Finish stage's action: make sure the session has a draft planned post, and
 * report which one.
 *
 * The remix-to-brief bridge is the planned post, not the session: `planned_posts.remixSessionId`
 * is the column that carries the remix back into the brief. Without this step a finished
 * remix stopped at "script saved, maybe added to a plan if the user filled in a date",
 * and the post brief had no way in.
 *
 * Idempotent. Calling it twice reuses the plan it already linked rather than filling the
 * calendar with duplicates, which matters because the finish view's button is a plain
 * button a user can click twice — and also re-reconciles the attached script every time,
 * which matters because the finish view's local "already finished" state resets on a
 * page reload, so revisiting this stage after a regenerate is exactly when a stale
 * attach needs to be caught and repaired.
 *
 * The plan is created with no date. A finish is not a scheduling decision, and inventing
 * a date the user did not pick would put a commitment on their calendar that they never
 * made; a dateless plan reads as a draft, which is what it is.
 */
export async function finishRemix(id: string): Promise<RemixFinishResult> {
  const session = await getSession(id);

  const [existing] = await db
    .select({ id: tables.plannedPosts.id, scriptId: tables.plannedPosts.scriptId })
    .from(tables.plannedPosts)
    .where(eq(tables.plannedPosts.remixSessionId, id))
    .orderBy(desc(tables.plannedPosts.createdAt))
    .limit(1);

  const script = await reconcileAttachedScript(session);

  await updateStage(id, { stage: "finish" });

  if (existing) {
    if (existing.scriptId !== (script?.id ?? null)) {
      await db
        .update(tables.plannedPosts)
        .set({ scriptId: script?.id ?? null, updatedAt: nowIso() })
        .where(eq(tables.plannedPosts.id, existing.id));
    }
    return { postId: existing.id, created: false, scriptId: script?.id ?? null };
  }

  const postId = newId();
  const now = nowIso();
  await db.insert(tables.plannedPosts).values({
    id: postId,
    state: "draft",
    title: script?.title ?? deriveScriptTitle(session.topic),
    plannedDate: null,
    scriptId: script?.id ?? null,
    remixSessionId: id,
    sourceVideoId: session.sourceVideoId,
    targetLengthSec: session.targetLengthSec,
    createdAt: now,
    updatedAt: now,
  });

  return { postId, created: true, scriptId: script?.id ?? null };
}

/**
 * The Ideas inbox's "Create script" action (Task 10): reads the idea, seeds/reuses a
 * remix session for its source video (`getOrCreateSession`), seeds that session's
 * topic from the idea's concept, then marks the idea `scripted` and links it to the
 * session — the same `remixSessionId` FK `saveScript` sets on a finished script, so an
 * idea and the session it spawned stay traceable to each other from the moment it's
 * created, not only once a script is saved.
 */
export async function seedSessionFromIdea(ideaId: string): Promise<string> {
  const [idea] = await db.select().from(tables.idea).where(eq(tables.idea.id, ideaId)).limit(1);
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);

  const session = await getOrCreateSession(idea.sourceVideoId);
  await updateStage(session.id, { topic: idea.concept });

  await db
    .update(tables.idea)
    .set({ status: "scripted", remixSessionId: session.id, updatedAt: nowIso() })
    .where(eq(tables.idea.id, ideaId));

  return session.id;
}
