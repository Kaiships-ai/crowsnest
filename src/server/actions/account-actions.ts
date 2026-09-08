"use server";

import {
  addAccount,
  listAccounts,
  removeAccount,
  updateAccount,
  type IgAccount,
} from "@/server/services/accounts";

/**
 * Server actions for the multi-account Settings section. Thin wrappers over
 * services/accounts.ts, each returning a result object rather than throwing, matching the
 * other Settings actions. The UI calls router.refresh() after a successful mutation, so
 * these do not revalidate a path themselves.
 */

export async function listAccountsAction(): Promise<{ ok: true; accounts: IgAccount[] }> {
  return { ok: true, accounts: await listAccounts() };
}

export async function addAccountAction(input: {
  label: string;
  username: string;
  password?: string;
  proxy?: string;
  deviceSeed?: string;
}): Promise<{ ok: true; account: IgAccount } | { ok: false; error: string }> {
  return addAccount(input);
}

export async function setAccountStatusAction(
  id: string,
  status: "active" | "paused",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await updateAccount(id, { status });
  return r.ok ? { ok: true } : r;
}

export async function removeAccountAction(id: string): Promise<{ ok: true }> {
  await removeAccount(id);
  return { ok: true };
}
