"use server";

import { randomBytes } from "node:crypto";

import { invalidateTokenStatus } from "@/server/graph/token-status";
import { clearSecret, MANAGED_SECRETS, secretStatus, setSecret, type ManagedSecret, type SecretStatus } from "@/server/secrets/store";

type SimpleResult = { ok: true } | { ok: false; error: string };

function isManaged(name: string): name is ManagedSecret {
  return (MANAGED_SECRETS as readonly string[]).includes(name);
}

function invalidateSecretCaches(): void {
  invalidateTokenStatus();
}

/**
 * Settings panel's "Set"/"Replace" action for any of the seven `MANAGED_SECRETS`. The
 * value is write-only end to end: it arrives here from a masked `<input type="password">`
 * and this action returns only `{ ok }`, never the value or anything derived from it — see
 * `getSecretStatusAction` below for the read side.
 */
export async function setSecretAction(name: string, value: string): Promise<SimpleResult> {
  if (!isManaged(name)) return { ok: false, error: "unknown secret" };
  try {
    setSecret(name, value);
    invalidateSecretCaches();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to set secret" };
  }
}

/** Settings panel's "Clear" action, shown only when a secret's status source is "db" —
 *  clearing an env-sourced value here would do nothing (the env var itself is untouched),
 *  which is why the UI never offers Clear for `source === "env"`. */
export async function clearSecretAction(name: string): Promise<SimpleResult> {
  if (!isManaged(name)) return { ok: false, error: "unknown secret" };
  clearSecret(name);
  invalidateSecretCaches();
  return { ok: true };
}

/** Settings panel's read path for all seven secrets: configured/source only, never a
 *  value — see `store.ts`'s `secretStatus()`. Safe to call after every set/clear/regenerate
 *  to refresh the panel's rows. */
export async function getSecretStatusAction(): Promise<SecretStatus[]> {
  return secretStatus();
}

/**
 * `IG_SERVICE_TOKEN` is the one secret the panel never offers a blank "Set" for — it
 * always has a value (auto-generated on first use by `getOrCreateServiceToken`), so the
 * only meaningful action is to replace it with a fresh one. The random value is generated
 * here, server-side, rather than in the client and passed to `setSecretAction`: a token
 * strong enough to authenticate the sidecar must never be generated in a browser context.
 */
export async function regenerateServiceTokenAction(): Promise<SimpleResult> {
  setSecret("IG_SERVICE_TOKEN", randomBytes(32).toString("hex"));
  invalidateSecretCaches();
  return { ok: true };
}
