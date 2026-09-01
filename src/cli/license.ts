import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// Polar's customer-portal endpoints are public: no bearer token, the license key
// itself is the credential. Both calls REQUIRE `key` (not `license_key`) plus
// `organization_id`.
const POLAR_API = process.env.KAI_POLAR_API ?? "https://api.polar.sh";
const ORGANIZATION_ID =
  process.env.KAI_POLAR_ORG_ID ?? "ef96ed5d-6721-403c-98a8-184d43d13334";

export const entitlementPath = () =>
  process.env.KAI_HOME
    ? join(process.env.KAI_HOME, "entitlement.json")
    : join(homedir(), ".kai", "entitlement.json");

export type Entitlement = {
  key: string;
  activation_id: string;
  customer_id: string | null;
  validated_at: string;
};

export class LicenseError extends Error {
  /** True when Polar answered about the license itself (revoked, disabled), so
   *  retrying with a different activation cannot help. */
  readonly fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.fatal = fatal;
  }
}

type PolarResponse = { status: number; body: unknown };

async function post(path: string, body: unknown): Promise<PolarResponse> {
  const res = await fetch(`${POLAR_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Polar returns an empty body on some 4xx. Leave parsed null and let the
    // caller decide from the status.
  }
  return { status: res.status, body: parsed };
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

function polarMessage(body: unknown, fallback: string): string {
  const b = asRecord(body);
  if (typeof b.detail === "string") return b.detail;
  // Pydantic-style validation errors arrive as detail: [{ msg, loc }]
  if (Array.isArray(b.detail)) {
    const msgs = b.detail
      .map((d) => asRecord(d).msg)
      .filter((m): m is string => typeof m === "string");
    if (msgs.length) return msgs.join("; ");
  }
  if (typeof b.error === "string") return b.error;
  return fallback;
}

/**
 * Claim one of the license's activation slots. Returns the activation id, which
 * validate needs. The key is configured for 2 activations, so a third machine
 * gets rejected here rather than at validate.
 */
export async function activate(key: string, label = hostname()): Promise<string> {
  const { status, body } = await post(
    "/v1/customer-portal/license-keys/activate",
    { key, organization_id: ORGANIZATION_ID, label },
  );

  if (status === 404) {
    throw new LicenseError(
      `That license key was not found. Check it for typos, then try again. (Polar said: ${polarMessage(body, "not found")}.)`,
    );
  }
  if (status === 403) {
    // The key is real but out of activation slots. Only reachable when this
    // machine has no cached activation to fall back on.
    throw new LicenseError(
      `That license key is already active on 2 machines. Deactivate one in the Polar customer portal, then run \`kai login\` again. (Polar said: ${polarMessage(body, "forbidden")}.)`,
    );
  }
  if (status >= 400) {
    throw new LicenseError(polarMessage(body, `Polar returned HTTP ${status}.`));
  }

  const id = asRecord(body).id;
  if (typeof id !== "string" || !id) {
    throw new LicenseError("Polar accepted the key but returned no activation id.");
  }
  return id;
}

/**
 * Confirm the key is still valid for this activation. Cheap, and the only call
 * that proves entitlement.
 */
export async function validate(
  key: string,
  activationId: string,
): Promise<{ customerId: string | null }> {
  const { status, body } = await post(
    "/v1/customer-portal/license-keys/validate",
    { key, organization_id: ORGANIZATION_ID, activation_id: activationId },
  );

  if (status >= 400) {
    throw new LicenseError(
      `License validation failed (${polarMessage(body, `HTTP ${status}`)}).`,
    );
  }

  const b = asRecord(body);
  // Polar echoes the key object back; an explicit non-granted status is a refusal
  // even on a 200.
  const keyStatus = asRecord(b.license_key).status ?? b.status;
  if (typeof keyStatus === "string" && keyStatus !== "granted") {
    throw new LicenseError(`This license is ${keyStatus}, not granted.`, true);
  }

  const customerId = asRecord(b.license_key).customer_id ?? b.customer_id;
  return { customerId: typeof customerId === "string" ? customerId : null };
}

export function readEntitlement(): Entitlement | null {
  try {
    const raw = JSON.parse(readFileSync(entitlementPath(), "utf8")) as Partial<Entitlement>;
    if (!raw.key || !raw.activation_id) return null;
    return raw as Entitlement;
  } catch {
    return null;
  }
}

export function writeEntitlement(e: Entitlement): string {
  const path = entitlementPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // The file holds the license key in plaintext. 0600 keeps it out of reach of
  // other local accounts.
  writeFileSync(path, `${JSON.stringify(e, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/**
 * Full login. Reuses this machine's existing activation when there is one:
 * activating on every login would spend both of a 2-activation license's slots
 * the second time the same person runs `kai login`.
 */
export async function login(key: string): Promise<Entitlement> {
  const trimmed = key.trim();
  if (!trimmed) throw new LicenseError("No license key given.");

  const cached = readEntitlement();

  if (cached?.key === trimmed) {
    try {
      return persist(trimmed, cached.activation_id, await validate(trimmed, cached.activation_id));
    } catch (err) {
      // A revoked or disabled license is final. Anything else (the activation was
      // removed in the portal, the cache is stale) is worth a fresh activation.
      if (err instanceof LicenseError && err.fatal) throw err;
    }
  }

  const activationId = await activate(trimmed);
  return persist(trimmed, activationId, await validate(trimmed, activationId));
}

function persist(
  key: string,
  activationId: string,
  { customerId }: { customerId: string | null },
): Entitlement {
  const entitlement: Entitlement = {
    key,
    activation_id: activationId,
    customer_id: customerId,
    validated_at: new Date().toISOString(),
  };
  writeEntitlement(entitlement);
  return entitlement;
}
