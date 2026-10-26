import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { _resetSecretStoreForTests, getSecretStore, setSecretStore } from "../../../shared/secret-store";
import { getOrCreateServiceToken } from "./service-token";

const fakeKeychain = getSecretStore();
const envToken = process.env.IG_SERVICE_TOKEN;

beforeEach(async () => {
  migrate();
  await db.delete(tables.sealedSecrets);
  await db.delete(tables.secrets);
  delete process.env.IG_SERVICE_TOKEN;
});

afterEach(() => {
  setSecretStore(fakeKeychain);
  process.env.IG_SERVICE_TOKEN = envToken;
});

describe("getOrCreateServiceToken", () => {
  test("generates and seals one token, then returns the same one", () => {
    const token = getOrCreateServiceToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(getOrCreateServiceToken()).toBe(token);
  });

  test("with no SecretStore and no env token it says how to get one", () => {
    _resetSecretStoreForTests();
    expect(() => getOrCreateServiceToken()).toThrow("No sidecar token yet: open Lead Studio once, or set IG_SERVICE_TOKEN in the environment.");
  });

  test("with no SecretStore an env token still works", () => {
    _resetSecretStoreForTests();
    process.env.IG_SERVICE_TOKEN = "env-sidecar-token";
    expect(getOrCreateServiceToken()).toBe("env-sidecar-token");
  });
});
