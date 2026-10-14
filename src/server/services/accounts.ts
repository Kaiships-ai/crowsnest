import { asc, eq } from "drizzle-orm";

import { db, newId, nowIso, tables } from "@/server/db";
import { clearSecret, getSecret, setSecret } from "@/server/secrets/store";

/**
 * Multi-account sync (v0.3), the honest minimal slice. This module owns the account model,
 * sticky channel assignment, and the pure scheduler that groups a sync by account and keeps
 * one account's cooldown or failure from stopping the others. It deliberately does NOT
 * launch live sidecars or route real IG traffic per account: that needs live per-account
 * credentials to verify and is the documented next step (see
 * documents/architecture/data.md, Multi-account sync). Everything here is additive and back
 * compatible: with a single (default) account, planAccountSync returns one group with every
 * channel, so the existing single-account sync path is byte-for-byte unchanged.
 *
 * A per-account password is never stored on the account row; it lives in the secrets table
 * under `IG_PASSWORD::<accountId>`, the same handling as every other secret.
 */

export interface IgAccount {
  id: string;
  label: string;
  username: string;
  isDefault: boolean;
  status: "active" | "paused";
  proxy: string | null;
  deviceSeed: string | null;
  sessionPath: string | null;
  port: number | null;
  cooldownUntil: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const accountPasswordKey = (accountId: string) => `IG_PASSWORD::${accountId}`;

function rowToAccount(row: typeof tables.igAccounts.$inferSelect): IgAccount {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    isDefault: row.isDefault,
    status: (row.status as "active" | "paused") ?? "active",
    proxy: row.proxy ?? null,
    deviceSeed: row.deviceSeed ?? null,
    sessionPath: row.sessionPath ?? null,
    port: row.port ?? null,
    cooldownUntil: row.cooldownUntil ?? null,
    lastSyncAt: row.lastSyncAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAccounts(): Promise<IgAccount[]> {
  const rows = await db.select().from(tables.igAccounts).orderBy(asc(tables.igAccounts.createdAt));
  return rows.map(rowToAccount);
}

export async function getAccount(id: string): Promise<IgAccount | null> {
  const [row] = await db.select().from(tables.igAccounts).where(eq(tables.igAccounts.id, id)).limit(1);
  return row ? rowToAccount(row) : null;
}

export async function getDefaultAccount(): Promise<IgAccount | null> {
  const [row] = await db.select().from(tables.igAccounts).where(eq(tables.igAccounts.isDefault, true)).limit(1);
  return row ? rowToAccount(row) : null;
}

export interface AddAccountInput {
  label: string;
  username: string;
  password?: string;
  proxy?: string;
  deviceSeed?: string;
  port?: number;
  /** Force this account to be the default. The first account added is always the default. */
  isDefault?: boolean;
}

export async function addAccount(
  input: AddAccountInput,
): Promise<{ ok: true; account: IgAccount } | { ok: false; error: string }> {
  const label = input.label?.trim();
  const username = input.username?.trim().replace(/^@/, "");
  if (!label) return { ok: false, error: "label is required" };
  if (!username) return { ok: false, error: "username is required" };

  const existing = await listAccounts();
  if (existing.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: `an account for @${username} already exists` };
  }

  // The first account is always the default; after that, honor the flag.
  const makeDefault = existing.length === 0 || input.isDefault === true;
  if (makeDefault && existing.length > 0) {
    // Flip any current default off first: the single-default unique index rejects two.
    await db.update(tables.igAccounts).set({ isDefault: false, updatedAt: nowIso() }).where(eq(tables.igAccounts.isDefault, true));
  }

  const id = newId();
  const now = nowIso();
  await db.insert(tables.igAccounts).values({
    id,
    label,
    username,
    isDefault: makeDefault,
    status: "active",
    proxy: input.proxy?.trim() || null,
    deviceSeed: input.deviceSeed?.trim() || null,
    sessionPath: null,
    port: input.port ?? null,
    cooldownUntil: null,
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
  });
  if (input.password?.trim()) setSecret(accountPasswordKey(id), input.password.trim());

  const account = await getAccount(id);
  return { ok: true, account: account! };
}

export async function updateAccount(
  id: string,
  patch: Partial<Pick<IgAccount, "label" | "status" | "proxy" | "deviceSeed" | "port" | "cooldownUntil">> & { password?: string },
): Promise<{ ok: true; account: IgAccount } | { ok: false; error: string }> {
  const account = await getAccount(id);
  if (!account) return { ok: false, error: `account not found: ${id}` };
  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.proxy !== undefined) set.proxy = patch.proxy || null;
  if (patch.deviceSeed !== undefined) set.deviceSeed = patch.deviceSeed || null;
  if (patch.port !== undefined) set.port = patch.port;
  if (patch.cooldownUntil !== undefined) set.cooldownUntil = patch.cooldownUntil;
  await db.update(tables.igAccounts).set(set).where(eq(tables.igAccounts.id, id));
  if (patch.password?.trim()) setSecret(accountPasswordKey(id), patch.password.trim());
  const updated = await getAccount(id);
  return { ok: true, account: updated! };
}

export async function removeAccount(id: string): Promise<void> {
  clearSecret(accountPasswordKey(id));
  // Unassign this account's channels explicitly before deleting it. The schema declares
  // channels.accountId ON DELETE SET NULL, but SQLite's ALTER TABLE ADD COLUMN could not
  // carry that action into the migration, so relying on the FK would raise a FOREIGN KEY
  // constraint error here. Doing it ourselves is robust and keeps the fall-back-to-default
  // guarantee regardless of how the column was added.
  await db.update(tables.channels).set({ accountId: null }).where(eq(tables.channels.accountId, id));
  await db.delete(tables.igAccounts).where(eq(tables.igAccounts.id, id));
}

/** Sticky assignment: pin a channel to an account (or clear it back to the default). */
export async function setChannelAccount(channelId: string, accountId: string | null): Promise<void> {
  await db.update(tables.channels).set({ accountId }).where(eq(tables.channels.id, channelId));
}

/** Set or clear an account's cooldown. Per-account: only this account's clock moves. */
export async function setAccountCooldown(id: string, until: string | null): Promise<void> {
  await db.update(tables.igAccounts).set({ cooldownUntil: until, updatedAt: nowIso() }).where(eq(tables.igAccounts.id, id));
}

// ---------------------------------------------------------------- pure scheduler

/** Whether an account can sync right now: active and not inside a live cooldown. Pure. */
export function accountAvailable(account: IgAccount, nowMs: number): boolean {
  if (account.status !== "active") return false;
  if (account.cooldownUntil && Date.parse(account.cooldownUntil) > nowMs) return false;
  return true;
}

/** The account a channel syncs under: its sticky assignment, else the default. Pure. */
export function resolveAccountForChannel<A extends { id: string; isDefault: boolean }>(
  channel: { accountId: string | null },
  accounts: A[],
): A | null {
  if (channel.accountId) {
    const pinned = accounts.find((a) => a.id === channel.accountId);
    if (pinned) return pinned;
    // A dangling accountId (account removed) falls back to the default, never to nothing.
  }
  return accounts.find((a) => a.isDefault) ?? null;
}

export interface SyncGroup {
  account: IgAccount;
  channelIds: string[];
}
export interface SkippedGroup {
  account: IgAccount;
  channelIds: string[];
  reason: "paused" | "cooldown";
}
export interface SyncPlan {
  /** Runnable groups, one per available account, each with its own channels. Run these in
   *  sequence (or, once live per-account sidecars exist, bounded-parallel across groups). */
  groups: SyncGroup[];
  /** Groups whose account is paused or cooling down. Skipped so a sibling account is never
   *  blocked by them; surfaced (not dropped) so the caller can report why. */
  skipped: SkippedGroup[];
  /** Channels whose resolved account is missing entirely (no default). Should not happen
   *  once a default account exists, but reported rather than silently dropped. */
  unassignedChannelIds: string[];
}

/**
 * Group a set of channels by the account they sync under, splitting available accounts from
 * paused or cooling-down ones. Pure and deterministic (groups ordered by account.createdAt),
 * so it is fully unit-testable without a database or a live sidecar. This is the scheduler
 * assignment and per-account isolation the goal asks to test: a cooled-down or paused
 * account's channels land in `skipped`, and every other account's channels still run.
 */
export function planAccountSync(
  channels: { id: string; accountId: string | null }[],
  accounts: IgAccount[],
  nowMs: number,
): SyncPlan {
  const ordered = [...accounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byAccount = new Map<string, string[]>();
  const unassignedChannelIds: string[] = [];

  for (const ch of channels) {
    const account = resolveAccountForChannel(ch, ordered);
    if (!account) {
      unassignedChannelIds.push(ch.id);
      continue;
    }
    const list = byAccount.get(account.id) ?? [];
    list.push(ch.id);
    byAccount.set(account.id, list);
  }

  const groups: SyncGroup[] = [];
  const skipped: SkippedGroup[] = [];
  for (const account of ordered) {
    const channelIds = byAccount.get(account.id);
    if (!channelIds || channelIds.length === 0) continue;
    if (accountAvailable(account, nowMs)) {
      groups.push({ account, channelIds });
    } else {
      skipped.push({ account, channelIds, reason: account.status !== "active" ? "paused" : "cooldown" });
    }
  }
  return { groups, skipped, unassignedChannelIds };
}

// ---------------------------------------------------------------- sidecar plumbing

/**
 * The env a per-account sidecar would launch with, isolating its session, proxy, and device
 * identity from every other account. Pure (password passed in, never read here). This is
 * the hook for running one sidecar per account; a single-account install never calls it.
 * Only defined values are included, matching sidecar/control.ts's own childEnv contract.
 */
export function accountChildEnv(account: IgAccount, password: string | undefined): Record<string, string> {
  const env: Record<string, string> = { IG_USERNAME: account.username };
  if (password) env.IG_PASSWORD = password;
  if (account.proxy) env.IG_PROXY = account.proxy;
  if (account.deviceSeed) env.IG_DEVICE_SEED = account.deviceSeed;
  if (account.sessionPath) env.IG_SESSION_PATH = account.sessionPath;
  if (account.port) env.IG_SERVICE_PORT = String(account.port);
  return env;
}

/** Read an account's password from the secrets store (for launching its sidecar). */
export function accountPassword(accountId: string): string | undefined {
  return getSecret(accountPasswordKey(accountId));
}
