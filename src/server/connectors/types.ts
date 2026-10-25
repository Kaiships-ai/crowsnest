import type { PullResult } from "@/server/lib/pull-result";
import type { CountId } from "@/server/metrics/ledger";

export type AuthKind = "oauth" | "api-key" | "browser-session" | "cli" | "mcp";

export interface SecretSpec {
  name: string;
  label: string;
  perAccount?: true;
  optional?: true;
}

export interface ConnectorManifest {
  id: string;
  label: string;
  auth: AuthKind;
  secrets: readonly SecretSpec[];
  feeds: readonly CountId[];
}

export interface ConnectionCheck {
  ok: boolean;
  message: string | null;
}

export interface ConnectorAdapter {
  testConnection(): Promise<ConnectionCheck>;
  pull?(): Promise<PullResult<unknown, unknown>>;
}

export interface Connector {
  manifest: ConnectorManifest;
  adapter: ConnectorAdapter | null;
}

export type SecretName<M extends ConnectorManifest> = M["secrets"][number]["name"];
