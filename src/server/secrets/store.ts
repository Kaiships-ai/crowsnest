import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { secrets } from "@/server/db/schema";

/**
 * The seven secrets the Settings UI (a later task) manages. A db row always wins over
 * the matching env var, so a value set through the UI takes effect without a restart —
 * env only remains as the bootstrap/dev-machine fallback.
 *
 * Values are plaintext in the local sqlite (no encryption) and are never returned to the
 * browser or logged: `secretStatus()` below reports configured/source only, never value.
 */
export const MANAGED_SECRETS = [
  "IG_SERVICE_TOKEN",
  "IG_USERNAME",
  "IG_PASSWORD",
  "IG_SESSIONID",
  "IG_GRAPH_TOKEN",
  "IG_GRAPH_USER_ID",
  "GROQ_API_KEY",
] as const;
export type ManagedSecret = (typeof MANAGED_SECRETS)[number];

export interface SecretStatus {
  name: ManagedSecret;
  configured: boolean;
  source: "db" | "env" | "none";
}

function dbValue(name: string): string | undefined {
  const row = db.select().from(secrets).where(eq(secrets.name, name)).get();
  return row && row.value ? row.value : undefined;
}

export function getSecret(name: string): string | undefined {
  const fromDb = dbValue(name);
  if (fromDb) return fromDb;
  const env = process.env[name];
  return env && env.length > 0 ? env : undefined;
}

export function setSecret(name: string, value: string): void {
  const v = value.trim();
  if (!v) throw new Error("secret value is empty");
  const now = new Date().toISOString();
  db.insert(secrets)
    .values({ name, value: v, updatedAt: now })
    .onConflictDoUpdate({ target: secrets.name, set: { value: v, updatedAt: now } })
    .run();
}

export function clearSecret(name: string): void {
  db.delete(secrets).where(eq(secrets.name, name)).run();
}

export function secretStatus(): SecretStatus[] {
  return MANAGED_SECRETS.map((name) => {
    if (dbValue(name)) return { name, configured: true, source: "db" as const };
    const env = process.env[name];
    if (env && env.length > 0) return { name, configured: true, source: "env" as const };
    return { name, configured: false, source: "none" as const };
  });
}

/** Guarantees the instagrapi sidecar's shared secret exists without requiring
 *  IG_SERVICE_TOKEN to be set in the environment at boot (config.ts leaves it optional
 *  for exactly this reason). First call generates and persists a random token; every
 *  call after that returns the same value. */
export function getOrCreateServiceToken(): string {
  const existing = getSecret("IG_SERVICE_TOKEN");
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  setSecret("IG_SERVICE_TOKEN", token);
  return token;
}
