import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { sealedSecrets, secrets } from "@/server/db/schema";
import { getSecretStore, hasSecretStore } from "../../shared/secret-store";

export type SecretSource = "keychain" | "db" | "env" | "none";

function keychain() {
  if (!hasSecretStore()) return null;
  const store = getSecretStore();
  return store.isEncryptionAvailable() ? store : null;
}

function unseal(name: string): string | undefined {
  const row = db.select().from(sealedSecrets).where(eq(sealedSecrets.name, name)).get();
  const store = row && keychain();
  if (!row || !store) return undefined;
  try {
    return store.decryptString(Buffer.from(row.sealed, "base64")) || undefined;
  } catch {
    return undefined;
  }
}

function legacyValue(name: string): string | undefined {
  return db.select().from(secrets).where(eq(secrets.name, name)).get()?.value || undefined;
}

function envValue(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function getSecret(name: string): string | undefined {
  return unseal(name) ?? legacyValue(name) ?? envValue(name);
}

export function secretSource(name: string): SecretSource {
  if (unseal(name)) return "keychain";
  if (legacyValue(name)) return "db";
  return envValue(name) ? "env" : "none";
}

export function setSecret(name: string, value: string): void {
  const v = value.trim();
  if (!v) throw new Error("secret value is empty");
  const store = keychain();
  if (!store) throw new Error("the macOS Keychain is unavailable, so the secret was not saved");
  const sealed = store.encryptString(v).toString("base64");
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(sealedSecrets)
      .values({ name, sealed, updatedAt: now })
      .onConflictDoUpdate({ target: sealedSecrets.name, set: { sealed, updatedAt: now } })
      .run();
    const back = tx.select().from(sealedSecrets).where(eq(sealedSecrets.name, name)).get();
    if (!back || store.decryptString(Buffer.from(back.sealed, "base64")) !== v) {
      throw new Error("the Keychain read-back did not match, so the secret was not saved");
    }
    tx.delete(secrets).where(eq(secrets.name, name)).run();
  });
}

export function clearSecret(name: string): void {
  db.transaction((tx) => {
    tx.delete(sealedSecrets).where(eq(sealedSecrets.name, name)).run();
    tx.delete(secrets).where(eq(secrets.name, name)).run();
  });
}

export interface SecretMigrationReport {
  moved: string[];
  failed: { name: string; reason: string }[];
}

export function migrateSecretsToKeychain(): SecretMigrationReport {
  const report: SecretMigrationReport = { moved: [], failed: [] };
  for (const row of db.select().from(secrets).all()) {
    if (!row.value.trim()) {
      db.delete(secrets).where(eq(secrets.name, row.name)).run();
      continue;
    }
    try {
      setSecret(row.name, row.value);
      report.moved.push(row.name);
    } catch (e) {
      report.failed.push({ name: row.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
