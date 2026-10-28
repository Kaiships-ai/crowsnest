import { db } from "@/server/db";
import { clearSecret, getSecret, secretSource, setSecret, type SecretSource } from "@/server/secrets/store";
import type { ConnectorManifest, SecretName } from "./types";

export { SecretLockedError } from "@/server/secrets/store";

function key<M extends ConnectorManifest>(manifest: M, name: SecretName<M>, accountId?: string): string {
  const spec = manifest.secrets.find((s) => s.name === name);
  if (!spec) throw new Error(`${manifest.id} declares no secret ${name}`);
  if (!accountId) return name;
  if (!spec.perAccount) throw new Error(`${name} is not stored per account`);
  return `${name}::${accountId}`;
}

export function readSecret<M extends ConnectorManifest>(manifest: M, name: SecretName<M>, accountId?: string): string | undefined {
  return getSecret(key(manifest, name, accountId));
}

export function writeSecret<M extends ConnectorManifest>(manifest: M, name: SecretName<M>, value: string, accountId?: string): void {
  setSecret(key(manifest, name, accountId), value);
}

export function deleteSecret<M extends ConnectorManifest>(manifest: M, name: SecretName<M>, accountId?: string): void {
  clearSecret(key(manifest, name, accountId));
}

/** Writes several of a connector's secrets and deletes retired ones as one transaction: one failed write keeps every old value. */
export function writeSecrets<M extends ConnectorManifest>(manifest: M, values: [SecretName<M>, string][], retired: readonly string[] = []): void {
  db.transaction(() => {
    for (const [name, value] of values) writeSecret(manifest, name, value);
    for (const name of retired) clearSecret(name);
  });
}

export function readSecretSource<M extends ConnectorManifest>(manifest: M, name: SecretName<M>): SecretSource {
  return secretSource(key(manifest, name));
}
