import type { PullResult } from "@/server/lib/pull-result";
import type { CountId } from "@/server/metrics/ledger";

export type AuthKind = "oauth" | "api-key" | "browser-session" | "cli" | "mcp";

export interface SecretSpec {
  name: string;
  label: string;
  /** Also stored once per IG account, keyed `<name>::<accountId>`. */
  perAccount?: true;
  /** The connector works without it (generated on first use, or one of two logins). */
  optional?: true;
}

/** What a connector is, as data. A folder under `src/server/connectors/` exports one. */
export interface ConnectorManifest {
  id: string;
  label: string;
  auth: AuthKind;
  secrets: readonly SecretSpec[];
  /** Ledger counts this source fills. */
  feeds: readonly CountId[];
}

export interface ConnectionCheck {
  ok: boolean;
  message: string | null;
}

export interface ConnectorAdapter {
  /** Never throws. */
  testConnection(): Promise<ConnectionCheck>;
  pull?(): Promise<PullResult<unknown, unknown>>;
}

/** `adapter: null` is a manifest-only connector: listed, never called. */
export interface Connector {
  manifest: ConnectorManifest;
  adapter: ConnectorAdapter | null;
}

export type SecretName<M extends ConnectorManifest> = M["secrets"][number]["name"];
