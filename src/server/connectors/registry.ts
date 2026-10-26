import type { SecretSource } from "@/server/secrets/store";
import { readSecretSource } from "./secrets";
import type { AuthKind, ConnectionCheck, Connector, ConnectorManifest, SecretSpec } from "./types";

export function buildRegistry(modules: Record<string, { connector: Connector }>): Connector[] {
  const owners = new Map<string, string>();
  const connectors = Object.entries(modules).map(([path, { connector }]) => {
    const folder = path.split("/").at(-2);
    if (connector.manifest.id !== folder) throw new Error(`${path} exports connector "${connector.manifest.id}"; its id must be its folder name`);
    for (const { name } of connector.manifest.secrets) {
      const owner = owners.get(name);
      if (owner) throw new Error(`secret ${name} is declared by both ${owner} and ${folder}`);
      owners.set(name, folder);
    }
    return connector;
  });
  return connectors.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export const CONNECTORS = buildRegistry(import.meta.glob<{ connector: Connector }>("./*/index.ts", { eager: true }));

export type ConnectorStatus = "not-connected" | "needs-setup" | "configured";

export interface ConnectorView {
  id: string;
  label: string;
  auth: AuthKind;
  feeds: readonly string[];
  status: ConnectorStatus;
  secrets: { name: string; label: string; optional: boolean; source: SecretSource }[];
}

function view({ manifest, adapter }: Connector): ConnectorView {
  const secrets = manifest.secrets.map((s) => ({ name: s.name, label: s.label, optional: Boolean(s.optional), source: readSecretSource(manifest, s.name) }));
  const status: ConnectorStatus = !adapter ? "not-connected" : secrets.some((s) => !s.optional && s.source === "none") ? "needs-setup" : "configured";
  return { id: manifest.id, label: manifest.label, auth: manifest.auth, feeds: manifest.feeds, status, secrets };
}

export function listConnectors(registry: Connector[] = CONNECTORS): ConnectorView[] {
  return registry.map(view);
}

export async function testConnector(id: string, registry: Connector[] = CONNECTORS): Promise<ConnectionCheck> {
  const adapter = registry.find((c) => c.manifest.id === id)?.adapter;
  if (!adapter) return { ok: false, message: `${id} is not connected` };
  try {
    return await adapter.testConnection();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : `${id} connection check failed` };
  }
}

export function managedSecrets(registry: Connector[] = CONNECTORS): { manifest: ConnectorManifest; spec: SecretSpec }[] {
  return registry.filter((c) => c.adapter).flatMap(({ manifest }) => manifest.secrets.map((spec) => ({ manifest, spec })));
}
