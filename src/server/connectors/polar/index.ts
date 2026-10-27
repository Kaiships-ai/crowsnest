import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { recordCheck } from "@/server/services/connector-status";
import { readSecret, writeSecret } from "../secrets";
import type { Connector, ConnectorManifest } from "../types";

const polar = {
  id: "polar",
  label: "Polar",
  auth: "api-key",
  secrets: [{ name: "POLAR_ACCESS_TOKEN", label: "Access token" }],
  feeds: ["purchase", "revenue"],
} as const satisfies ConnectorManifest;

const POLAR_REJECTED = "Polar rejected the token (401). Create a new organization token and paste it.";
const POLAR_UNREACHABLE = "Cannot reach Polar. Check your internet connection, then test again.";
const NO_ORGANIZATION = "This token sees no organization. Create an organization access token and paste it.";
const NO_TOKEN = "Add your Polar access token to connect.";
/** The organization the saved token last proved, for the Ready card. Not a secret. */
const ORGANIZATION_KEY = "polar_organization";

type TokenCheck = { ok: true; organization: string } | { ok: false; message: string };

/** One real read: the organizations this token sees. `POLAR_API_URL` points a verify lane at a fake. */
async function checkPolarToken(token: string): Promise<TokenCheck> {
  let res: Response;
  try {
    res = await fetch(`${process.env.POLAR_API_URL ?? "https://api.polar.sh"}/v1/organizations`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: POLAR_UNREACHABLE };
  }
  if (res.status === 401) return { ok: false, message: POLAR_REJECTED };
  if (!res.ok) return { ok: false, message: `Polar answered ${res.status}. Test again in a minute.` };
  const body: unknown = await res.json().catch(() => null);
  const name = organizationName(body);
  return name ? { ok: true, organization: name } : { ok: false, message: NO_ORGANIZATION };
}

function organizationName(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("items" in body) || !Array.isArray(body.items)) return null;
  const first: unknown = body.items[0];
  return typeof first === "object" && first !== null && "name" in first && typeof first.name === "string" ? first.name : null;
}

export function readPolarOrganization(): string | null {
  return db.select().from(tables.appSettings).where(eq(tables.appSettings.key, ORGANIZATION_KEY)).get()?.value ?? null;
}

function storeOrganization(name: string): void {
  db.insert(tables.appSettings).values({ key: ORGANIZATION_KEY, value: name }).onConflictDoUpdate({ target: tables.appSettings.key, set: { value: name } }).run();
}

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
  storeOrganization(passedDraft.organization);
  recordCheck(polar.id, { ok: true, message: null });
  passedDraft = null;
  return { ok: true };
}

export const connector: Connector = {
  manifest: polar,
  adapter: {
    async testConnection() {
      const token = readSecret(polar, "POLAR_ACCESS_TOKEN");
      if (!token) return { ok: false, message: NO_TOKEN };
      const check = await checkPolarToken(token);
      if (!check.ok) return { ok: false, message: check.message };
      storeOrganization(check.organization);
      return { ok: true, message: null };
    },
  },
};
