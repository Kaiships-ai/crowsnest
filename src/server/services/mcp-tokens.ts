import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
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

const liveTokens = () => db.select().from(tables.mcpTokens).where(isNull(tables.mcpTokens.revokedAt)).all();

export function createMcpToken(name: string): { id: string; name: string; token: string } {
  const valid = TokenNameSchema.parse(name);
  if (liveTokens().some((t) => t.name === valid)) throw new Error(`a live MCP token is already named ${valid}; revoke it first`);
  return insertToken(valid);
}

export function revokeMcpToken(id: string): { revoked: boolean } {
  const res = db.update(tables.mcpTokens).set({ revokedAt: nowIso() }).where(and(eq(tables.mcpTokens.id, id), isNull(tables.mcpTokens.revokedAt))).run();
  return { revoked: res.changes > 0 };
}

export function rotateLocalMcpToken(): string {
  return db.transaction(() => {
    db.update(tables.mcpTokens).set({ revokedAt: nowIso() }).where(and(eq(tables.mcpTokens.name, LOCAL_TOKEN_NAME), isNull(tables.mcpTokens.revokedAt))).run();
    return insertToken(LOCAL_TOKEN_NAME).token;
  });
}

export function writeLocalMcpTokenFile(file: string): void {
  rmSync(file, { force: true });
  writeFileSync(file, rotateLocalMcpToken(), { mode: 0o600 });
}

function findLiveTokenInConstantTime(presented: Buffer) {
  let found: { id: string; name: string } | null = null;
  for (const row of liveTokens()) {
    if (timingSafeEqual(presented, Buffer.from(row.tokenHash, "hex"))) found = row;
  }
  return found;
}

export function authenticateMcpToken(authorization: string | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match) return null;
  const found = findLiveTokenInConstantTime(hashOf(match[1]));
  if (found) db.update(tables.mcpTokens).set({ lastUsedAt: nowIso() }).where(eq(tables.mcpTokens.id, found.id)).run();
  return found?.name ?? null;
}
