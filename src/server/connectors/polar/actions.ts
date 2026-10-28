import { recordCheck } from "@/server/services/connector-status";
import { writeSecret } from "../secrets";
import { checkPolarToken, polar, storeOrganization, type TokenCheck } from "./index";

// The Polar form's bridge calls. They live outside index.ts, which the registry loads,
// because connector-status imports the registry.
// ponytail: one draft at a time is all the dialog has, so the last passing draft is the only one Save accepts.
let passedDraft: { token: string; organization: string } | null = null;

/** Test connection in the dialog: checks a draft token. Records nothing, so Cancel leaves the card as it was. */
export async function testPolarTokenAction(token: string): Promise<TokenCheck> {
  const check = await checkPolarToken(token.trim());
  passedDraft = check.ok ? { token: token.trim(), organization: check.organization } : null;
  return check;
}

/** Save in the dialog: stores a draft that just passed Test connection, without testing again. */
export async function savePolarTokenAction(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!passedDraft || passedDraft.token !== token.trim()) return { ok: false, error: "Test the token before you save it." };
  writeSecret(polar, "POLAR_ACCESS_TOKEN", passedDraft.token);
  storeOrganization(passedDraft.organization, passedDraft.token);
  recordCheck(polar.id, { ok: true, message: null });
  passedDraft = null;
  return { ok: true };
}
