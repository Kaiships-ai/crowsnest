import { and, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { getLlm, type LlmClient } from "@/server/llm/client";
import { IdeaSchema } from "@/server/llm/schemas";
import { getPersona } from "./persona";
import { log } from "@/server/lib/logger";

const IDEA_SYSTEM =
  `You are a short-form content strategist. Given how one video worked (its hook, structure, ` +
  `format, style and why it worked) plus the creator's audience/voice/do/don't guidance, propose ` +
  `ONE new video idea that borrows the same mechanism for this creator's own audience. Return a ` +
  `one-line "concept" (10-20 words, no hashtags, no numbering) and a short "angle" (1-2 sentences) ` +
  `explaining the specific spin that makes it fresh rather than a copy.`;

function buildIdeaUser(opts: {
  hookType: string | null;
  structureSegments: { label: string; startSec: number; endSec: number; note: string }[] | null;
  formatTags: string[] | null;
  styleTags: string[] | null;
  whyItWorked: string | null;
  summary: string | null;
  audience: string;
  voice: string;
  do: string;
  dont: string;
}): string {
  const structure = opts.structureSegments?.length
    ? opts.structureSegments.map((s) => `${s.label} (${s.startSec}-${s.endSec}s): ${s.note}`).join("; ")
    : "no structure recorded";

  const lines = [
    `Source video analysis:`,
    `Hook type: ${opts.hookType ?? "unknown"}`,
    `Structure: ${structure}`,
    `Format tags: ${opts.formatTags?.join(", ") || "none"}`,
    `Style tags: ${opts.styleTags?.join(", ") || "none"}`,
    `Why it worked: ${opts.whyItWorked ?? "unknown"}`,
    `Summary: ${opts.summary ?? "unknown"}`,
  ];

  if (opts.audience) lines.push(`Audience: ${opts.audience}`);
  if (opts.voice) lines.push(`Voice: ${opts.voice}`);
  if (opts.do) lines.push(`Do: ${opts.do}`);
  if (opts.dont) lines.push(`Don't: ${opts.dont}`);

  return lines.join("\n");
}

/**
 * Reads a video's `video_analyses` row plus the single `persona` row, asks the LLM
 * (the same `LlmClient` used by `services/remix.ts`) for a one-line `concept` and a
 * short `angle`, and upserts the `idea` row keyed on `sourceVideoId`.
 *
 * Upsert is select-then-update rather than a DB `onConflictDoUpdate`: the table has no
 * plain unique constraint to conflict on (its uniqueness is the *partial* index
 * `idea_source_active`, "at most one non-discarded idea per source video" — see the
 * comment on `idea` in `db/schema.ts` — which `onConflictDoUpdate`'s `target` cannot
 * target). Selecting the existing non-discarded row first and updating it by id is the
 * upsert mechanism; the partial index is the DB-level backstop against a race.
 *
 * Never throws on a bad LLM reply (malformed structured output, network error, no API
 * key): logs at error level and returns `{ id: "", created: false }` so the sync pass
 * that calls this per analyzed video is never broken by one bad idea.
 */
export async function generateIdea(videoId: string, opts?: { llm?: LlmClient }): Promise<{ id: string; created: boolean }> {
  try {
    const [video] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    const persona = await getPersona();
    const client = opts?.llm ?? getLlm();

    const user = buildIdeaUser({
      hookType: analysis?.hookType ?? null,
      structureSegments: analysis?.structureSegments ?? null,
      formatTags: analysis?.formatTags ?? null,
      styleTags: analysis?.styleTags ?? null,
      whyItWorked: analysis?.whyItWorked ?? null,
      summary: analysis?.summary ?? null,
      audience: persona.audience,
      voice: persona.voice,
      do: persona.do,
      dont: persona.dont,
    });

    const result = await client.generateParsed({ system: IDEA_SYSTEM, user, schema: IdeaSchema });

    const now = nowIso();
    const scoreAtCreation = video?.outlierScore ?? null;

    const [existing] = await db
      .select()
      .from(tables.idea)
      .where(and(eq(tables.idea.sourceVideoId, videoId), ne(tables.idea.status, "discarded")))
      .limit(1);

    if (existing) {
      await db
        .update(tables.idea)
        .set({ concept: result.concept, angle: result.angle, scoreAtCreation, updatedAt: now })
        .where(eq(tables.idea.id, existing.id));
      return { id: existing.id, created: false };
    }

    const id = newId();
    await db.insert(tables.idea).values({
      id,
      sourceVideoId: videoId,
      concept: result.concept,
      angle: result.angle,
      status: "inbox",
      scoreAtCreation,
      createdAt: now,
      updatedAt: now,
    });
    return { id, created: true };
  } catch (err) {
    log.error("idea.generate.failed", { videoId, error: err instanceof Error ? err.message : String(err) });
    return { id: "", created: false };
  }
}

/**
 * The sync's auto-generate pass: finds a channel's analyzed outliers and calls
 * {@link generateIdea} on each. "Analyzed" is the v1 boundary — matched with an inner
 * join on `video_analyses`, the same row `generateIdea` itself reads — so a freshly
 * imported or unscored video is never a candidate no matter how high `outlierScore`
 * eventually goes. Newest-first, capped, mirroring `enrichmentCandidates`'s own
 * candidate query in `sync-engine.ts` (`enrichViewCounts`'s template): a channel with a
 * long backlog of past outliers should not spend a whole sync calling the LLM once per
 * row.
 *
 * `shouldStop`/`tick` are optional and consulted once per candidate, the same contract
 * `enrichViewCounts` uses for its own `shouldStop`/`tick` — `sync-engine.ts` wires them
 * to `tracker.isCancelRequested`/`tracker.flushIfDue` so a long pass (up to `cap` LLM
 * calls) still yields to a Stop click and keeps the run's heartbeat alive instead of
 * running silently to completion. A caller with no tracker (this file's own test, or a
 * one-off script) simply omits them.
 *
 * Never throws: a failure reading candidates, or the run's own tracker callbacks,
 * ends the pass early rather than escaping — `generateIdea` per row already never
 * throws on its own account, so nothing here needs a try/catch around it.
 */
export async function generateIdeasForNewOutliers(
  channelId: string,
  opts: {
    threshold?: number;
    cap?: number;
    llm?: LlmClient;
    shouldStop?: () => Promise<boolean>;
    tick?: () => Promise<void>;
  } = {}
): Promise<{ candidates: number; created: number; stopped: boolean }> {
  const threshold = opts.threshold ?? 3;
  const cap = opts.cap ?? 20;

  let candidates: { id: string }[];
  try {
    candidates = await db
      .select({ id: tables.videos.id })
      .from(tables.videos)
      .innerJoin(tables.videoAnalyses, eq(tables.videoAnalyses.videoId, tables.videos.id))
      .where(
        and(
          eq(tables.videos.channelId, channelId),
          gte(tables.videos.outlierScore, threshold),
          isNull(tables.videos.deletedAt)
        )
      )
      .orderBy(desc(tables.videos.postedAt))
      .limit(cap);
  } catch (err) {
    log.error("idea.auto_pass.candidates_failed", {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { candidates: 0, created: 0, stopped: true };
  }

  let created = 0;
  for (const row of candidates) {
    try {
      await opts.tick?.();
      if (await opts.shouldStop?.()) {
        return { candidates: candidates.length, created, stopped: true };
      }
    } catch (err) {
      log.error("idea.auto_pass.tracker_failed", {
        channelId,
        error: err instanceof Error ? err.message : String(err),
        candidates: candidates.length,
        created,
      });
      return { candidates: candidates.length, created, stopped: true };
    }

    const result = await generateIdea(row.id, { llm: opts.llm });
    if (result.created) created += 1;
  }

  return { candidates: candidates.length, created, stopped: false };
}
