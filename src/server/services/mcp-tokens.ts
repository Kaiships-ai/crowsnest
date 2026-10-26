import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, getTableColumns, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, newId, nowIso, tables } from "@/server/db";

export const LOCAL_TOKEN_NAME = "local";
export const TokenNameSchema = z.string().trim().min(1).max(64).regex(/^[\w.-]+$/, "letters, digits, '.', '_' or '-' only");

const hashOf = (token: string) => createHash("sha256").update(token).digest();

function insertToken(name: string): { id: string; name: string; token: string } {
  const token = `cn_${randomBytes(32).toString("base64url")}`;
  const id = newId();
  db.insert(tables.mcpTokens).values({ id, name, tokenHash: hashOf(token).toString("hex"), createdAt: nowIso() }).run();
  return { id, name, token };
}

export function listMcpTokens() {
  const { tokenHash: _secret, ...columns } = getTableColumns(tables.mcpTokens);
  return db.select(columns).from(tables.mcpTokens).all();
}

/** The raw token is returned once here and never again. A live token already holding the name refuses (unique index). */
export function createMcpToken(name: string): { id: string; name: string; token: string } {
  return insertToken(TokenNameSchema.parse(name));
}

export function revokeMcpToken(id: string): { revoked: boolean } {
  const res = db.update(tables.mcpTokens).set({ revokedAt: nowIso() }).where(and(eq(tables.mcpTokens.id, id), isNull(tables.mcpTokens.revokedAt))).run();
  return { revoked: res.changes > 0 };
}

/** Only the hash is stored, so each app start revokes the old `local` token and mints a fresh one for `<userData>/mcp.token`. */
export function rotateLocalMcpToken(): string {
  return db.transaction(() => {
    db.update(tables.mcpTokens).set({ revokedAt: nowIso() }).where(and(eq(tables.mcpTokens.name, LOCAL_TOKEN_NAME), isNull(tables.mcpTokens.revokedAt))).run();
    return insertToken(LOCAL_TOKEN_NAME).token;
  });
}

/** The live token's name for an `Authorization: Bearer` header, or null. Compares every live hash in constant time. */
export function authenticateMcpToken(authorization: string | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match) return null;
  const presented = hashOf(match[1]);
  let found: { id: string; name: string } | null = null;
  for (const row of db.select().from(tables.mcpTokens).where(isNull(tables.mcpTokens.revokedAt)).all()) {
    if (timingSafeEqual(presented, Buffer.from(row.tokenHash, "hex"))) found = row;
  }
  if (found) db.update(tables.mcpTokens).set({ lastUsedAt: nowIso() }).where(eq(tables.mcpTokens.id, found.id)).run();
  return found?.name ?? null;
}
