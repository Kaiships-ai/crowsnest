import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LicenseError, login, readEntitlement, writeEntitlement } from "./license";

const ORG = "ef96ed5d-6721-403c-98a8-184d43d13334";
const KEY = "ksa_testkey";

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];

/** Queue one response per fetch, in order. */
function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch to ${url}`);
      return {
        status: next.status,
        json: async () => next.body,
      } as unknown as Response;
    }),
  );
}

const okActivate = { status: 200, body: { id: "act_1" } };
const okValidate = {
  status: 200,
  body: { status: "granted", license_key: { status: "granted", customer_id: "cus_1" } },
};

beforeEach(() => {
  calls = [];
  process.env.KAI_HOME = mkdtempSync(join(tmpdir(), "kai-test-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.KAI_HOME;
});

describe("login", () => {
  test("activates first, then validates with the activation id", async () => {
    stubFetch([okActivate, okValidate]);

    const e = await login(KEY);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/v1/customer-portal/license-keys/activate");
    expect(calls[1].url).toContain("/v1/customer-portal/license-keys/validate");
    expect(calls[1].body.activation_id).toBe("act_1");
    expect(e.activation_id).toBe("act_1");
    expect(e.customer_id).toBe("cus_1");
  });

  test("sends `key`, not `license_key`, plus the organization id", async () => {
    stubFetch([okActivate, okValidate]);

    await login(KEY);

    for (const call of calls) {
      expect(call.body.key).toBe(KEY);
      expect(call.body).not.toHaveProperty("license_key");
      expect(call.body.organization_id).toBe(ORG);
    }
  });

  test("caches the entitlement at mode 0600", async () => {
    stubFetch([okActivate, okValidate]);

    await login(KEY);

    const path = join(process.env.KAI_HOME!, "entitlement.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).key).toBe(KEY);
  });

  test("a repeat login on the same machine validates the cached activation and never activates", async () => {
    writeEntitlement({
      key: KEY,
      activation_id: "act_mine",
      customer_id: null,
      validated_at: "2026-01-01T00:00:00.000Z",
    });
    stubFetch([okValidate]);

    const e = await login(KEY);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/validate");
    expect(calls[0].body.activation_id).toBe("act_mine");
    expect(e.activation_id).toBe("act_mine");
  });

  test("re-activates when the cached activation was removed in the portal", async () => {
    writeEntitlement({
      key: KEY,
      activation_id: "act_gone",
      customer_id: null,
      validated_at: "2026-01-01T00:00:00.000Z",
    });
    stubFetch([{ status: 404, body: { detail: "Not found" } }, okActivate, okValidate]);

    const e = await login(KEY);

    expect(e.activation_id).toBe("act_1");
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["validate", "activate", "validate"]);
  });

  test("a revoked license fails without trying to activate around it", async () => {
    writeEntitlement({
      key: KEY,
      activation_id: "act_mine",
      customer_id: null,
      validated_at: "2026-01-01T00:00:00.000Z",
    });
    stubFetch([{ status: 200, body: { license_key: { status: "revoked" } } }]);

    await expect(login(KEY)).rejects.toThrow(/revoked/);
    expect(calls).toHaveLength(1);
  });

  test("reuses this machine's activation when the key is out of slots", async () => {
    writeEntitlement({
      key: KEY,
      activation_id: "act_old",
      customer_id: null,
      validated_at: "2026-01-01T00:00:00.000Z",
    });
    // cached activation no longer validates, and the key has no slots left
    stubFetch([
      { status: 404, body: { detail: "Not found" } },
      { status: 403, body: { detail: "activation limit reached" } },
    ]);

    await expect(login(KEY)).rejects.toThrow(/2 machines/);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["validate", "activate"]);
  });

  test("refuses a third machine and says how to fix it", async () => {
    stubFetch([{ status: 403, body: { detail: "activation limit reached" } }]);

    await expect(login(KEY)).rejects.toThrow(/2 machines/);
  });

  test("rejects a key Polar does not know", async () => {
    stubFetch([{ status: 404, body: { detail: "License key not found" } }]);

    await expect(login("ksa_bogus")).rejects.toThrow(LicenseError);
  });

  test("rejects a revoked key even on a 200", async () => {
    stubFetch([okActivate, { status: 200, body: { license_key: { status: "revoked" } } }]);

    await expect(login(KEY)).rejects.toThrow(/revoked/);
  });

  test("rejects an empty key without calling Polar", async () => {
    stubFetch([]);

    await expect(login("   ")).rejects.toThrow(LicenseError);
    expect(calls).toHaveLength(0);
  });
});

describe("readEntitlement", () => {
  test("returns null when the cache is missing or malformed", () => {
    expect(readEntitlement()).toBeNull();
    writeFileSync(join(process.env.KAI_HOME!, "entitlement.json"), "{not json");
    expect(readEntitlement()).toBeNull();
  });
});
