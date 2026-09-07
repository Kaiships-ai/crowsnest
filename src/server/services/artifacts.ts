import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, newId, nowIso, tables } from "@/server/db";

/**
 * The content-machine persistence layer: agent-authored artifacts crowsnest is the source
 * of truth for. Mirrors services/analyze.ts's keyless, provenance-stamped write pattern,
 * generalized to the five artifact kinds the content flow produces. Never calls a model.
 * Every function returns a result object (or null) rather than throwing, so the MCP tools
 * can wrap it without an exception crossing the boundary.
 */

export const ARTIFACT_KINDS = ["angles", "outlier_library", "idea_bank", "monthly_plan", "brief"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// `data` is the agent's own JSON. z.unknown() would also accept `undefined` (a missing
// field), so refine to reject that: an artifact with no payload is never valid.
export const SaveArtifactSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().min(1, "title is required"),
  data: z.unknown().refine((v) => v !== undefined && v !== null, "data is required"),
  sourceVideoIds: z.array(z.string()).optional(),
  agent: z.string().min(1, "agent is required"),
  model: z.string().optional(),
  assumptions: z.string().optional(),
});
export type SaveArtifactInput = z.infer<typeof SaveArtifactSchema>;

export interface ContentArtifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  data: unknown;
  sourceVideoIds: string[] | null;
  agent: string;
  model: string | null;
  assumptions: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToArtifact(row: typeof tables.contentArtifacts.$inferSelect): ContentArtifact {
  return {
    id: row.id,
    kind: row.kind as ArtifactKind,
    title: row.title,
    data: row.data,
    sourceVideoIds: row.sourceVideoIds ?? null,
    agent: row.agent,
    model: row.model ?? null,
    assumptions: row.assumptions ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function byId(id: string): Promise<ContentArtifact | null> {
  const [row] = await db.select().from(tables.contentArtifacts).where(eq(tables.contentArtifacts.id, id)).limit(1);
  return row ? rowToArtifact(row) : null;
}

/**
 * Create an artifact, or update it in place when `input.id` names an existing one. Keyless.
 * Validates against SaveArtifactSchema (which enforces a known kind, a title, a payload,
 * and an agent for provenance). Returns the stored artifact so the caller never has to read
 * it back.
 */
export async function saveArtifact(
  input: unknown,
): Promise<{ ok: true; id: string; artifact: ContentArtifact } | { ok: false; error: string }> {
  const parsed = SaveArtifactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const a = parsed.data;
  const now = nowIso();

  const fields = {
    kind: a.kind,
    title: a.title,
    data: a.data,
    sourceVideoIds: a.sourceVideoIds ?? null,
    agent: a.agent,
    model: a.model ?? null,
    assumptions: a.assumptions ?? null,
  };

  if (a.id) {
    const existing = await byId(a.id);
    if (!existing) return { ok: false, error: `artifact not found: ${a.id}` };
    await db.update(tables.contentArtifacts).set({ ...fields, updatedAt: now }).where(eq(tables.contentArtifacts.id, a.id));
    const artifact = await byId(a.id);
    return { ok: true, id: a.id, artifact: artifact! };
  }

  const id = newId();
  await db.insert(tables.contentArtifacts).values({ id, ...fields, createdAt: now, updatedAt: now });
  const artifact = await byId(id);
  return { ok: true, id, artifact: artifact! };
}

export async function getArtifact(id: string): Promise<ContentArtifact | null> {
  return byId(id);
}

/** Newest first, optionally filtered by kind. total counts every matching artifact; items
 *  is the requested page. */
export async function listArtifacts(
  opts: { kind?: ArtifactKind; limit?: number; offset?: number } = {},
): Promise<{ total: number; count: number; items: ContentArtifact[] }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const where = opts.kind ? eq(tables.contentArtifacts.kind, opts.kind) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(tables.contentArtifacts)
    .where(where);

  const rows = await db
    .select()
    .from(tables.contentArtifacts)
    .where(where)
    .orderBy(desc(tables.contentArtifacts.createdAt))
    .limit(limit)
    .offset(offset);

  return { total, count: rows.length, items: rows.map(rowToArtifact) };
}
