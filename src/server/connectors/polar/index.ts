import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { readSecret } from "../secrets";
import type { Connector, ConnectorManifest } from "../types";

export const polar = {
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

export type TokenCheck = { ok: true; organization: string } | { ok: false; message: string };

/** One real read: the organizations this token sees. `POLAR_API_URL` points a verify lane at a fake. */
export async function checkPolarToken(token: string): Promise<TokenCheck> {
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

export function storeOrganization(name: string): void {
  db.insert(tables.appSettings).values({ key: ORGANIZATION_KEY, value: name }).onConflictDoUpdate({ target: tables.appSettings.key, set: { value: name } }).run();
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
