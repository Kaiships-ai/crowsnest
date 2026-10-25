import { clearSecret, getSecret, secretSource, setSecret, type SecretSource } from "@/server/secrets/store";
import type { ConnectorManifest, SecretName } from "./types";

/** The engine's only way to a secret: a connector manifest names every secret it may
 *  read, so a key no manifest declares does not type-check. */
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

export function readSecretSource<M extends ConnectorManifest>(manifest: M, name: SecretName<M>): SecretSource {
  return secretSource(key(manifest, name));
}
