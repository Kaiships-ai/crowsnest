"use server";

import { randomBytes } from "node:crypto";

import { igSidecar } from "@/server/connectors/ig-sidecar/manifest";
import { managedSecrets } from "@/server/connectors/registry";
import { deleteSecret, readSecretSource, writeSecret } from "@/server/connectors/secrets";
import { invalidateTokenStatus } from "@/server/graph/token-status";
import type { SecretSource } from "@/server/secrets/store";

type SimpleResult = { ok: true } | { ok: false; error: string };

export interface SecretStatus {
  name: string;
  configured: boolean;
  source: SecretSource;
}

function managed(name: string) {
  return managedSecrets().find((m) => m.spec.name === name);
}

export async function setSecretAction(name: string, value: string): Promise<SimpleResult> {
  const m = managed(name);
  if (!m) return { ok: false, error: "unknown secret" };
  try {
    writeSecret(m.manifest, name, value);
    invalidateTokenStatus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to set secret" };
  }
}

export async function clearSecretAction(name: string): Promise<SimpleResult> {
  const m = managed(name);
  if (!m) return { ok: false, error: "unknown secret" };
  deleteSecret(m.manifest, name);
  invalidateTokenStatus();
  return { ok: true };
}

export async function getSecretStatusAction(): Promise<SecretStatus[]> {
  return managedSecrets().map(({ manifest, spec }) => {
    const source = readSecretSource(manifest, spec.name);
    return { name: spec.name, configured: source !== "none", source };
  });
}

export async function regenerateServiceTokenAction(): Promise<SimpleResult> {
  try {
    writeSecret(igSidecar, "IG_SERVICE_TOKEN", randomBytes(32).toString("hex"));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to set secret" };
  }
}
