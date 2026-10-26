import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { _resetSecretStoreForTests, getSecretStore, setSecretStore, type SecretStore } from "../../shared/secret-store";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let store: typeof import("./store");

const fakeKeychain = getSecretStore();

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  store = await import("./store");
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
  await db.delete(tables.sealedSecrets);
  delete process.env.GROQ_API_KEY;
});

afterEach(() => setSecretStore(fakeKeychain));

function legacyRow(name: string, value: string) {
  db.insert(tables.secrets).values({ name, value, updatedAt: "2026-01-01T00:00:00.000Z" }).run();
}

function allStoredText(): string {
  return JSON.stringify([db.select().from(tables.secrets).all(), db.select().from(tables.sealedSecrets).all()]);
}

const brokenKeychain = (overrides: Partial<SecretStore>): SecretStore => ({ ...fakeKeychain, ...overrides });

describe("keychain store", () => {
  test("a set value reads back from the keychain and is not stored as plaintext", () => {
    store.setSecret("GROQ_API_KEY", "gsk-plain-value");
    expect(store.getSecret("GROQ_API_KEY")).toBe("gsk-plain-value");
    expect(store.secretSource("GROQ_API_KEY")).toBe("keychain");
    expect(allStoredText()).not.toContain("gsk-plain-value");
  });

  test("the keychain value wins over env, env fills in when nothing is stored", () => {
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
    store.setSecret("GROQ_API_KEY", "sealed-value");
    expect(store.getSecret("GROQ_API_KEY")).toBe("sealed-value");
    store.clearSecret("GROQ_API_KEY");
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
  });

  test("setSecret refuses an empty value and an unavailable keychain", () => {
    expect(() => store.setSecret("GROQ_API_KEY", "   ")).toThrow("empty");
    setSecretStore(brokenKeychain({ isEncryptionAvailable: () => false }));
    expect(() => store.setSecret("GROQ_API_KEY", "v")).toThrow("Keychain is unavailable");
    expect(db.select().from(tables.sealedSecrets).all()).toEqual([]);
  });

  test("a set drops the legacy plaintext row of the same name", () => {
    legacyRow("GROQ_API_KEY", "old-plain");
    store.setSecret("GROQ_API_KEY", "new-value");
    expect(db.select().from(tables.secrets).all()).toEqual([]);
    expect(allStoredText()).not.toContain("old-plain");
  });
});

describe("a host with no SecretStore (kai CLI, tsx scripts)", () => {
  test("a sealed secret fails loudly instead of reading as missing, unless env sets it", () => {
    store.setSecret("IG_USERNAME", "burner.acct");
    _resetSecretStoreForTests();
    expect(() => store.getSecret("IG_USERNAME")).toThrow("IG_USERNAME is sealed in the macOS Keychain, which only Lead Studio opens. Run this from Lead Studio, or set IG_USERNAME in the environment.");
    expect(store.secretSource("IG_USERNAME")).toBe("keychain");
    process.env.IG_USERNAME = "env.acct";
    expect(store.getSecret("IG_USERNAME")).toBe("env.acct");
    delete process.env.IG_USERNAME;
  });

  test("a legacy row nobody migrated still reads", () => {
    legacyRow("GROQ_API_KEY", "legacy-key");
    _resetSecretStoreForTests();
    expect(store.getSecret("GROQ_API_KEY")).toBe("legacy-key");
  });

  test("a write is refused", () => {
    _resetSecretStoreForTests();
    expect(() => store.setSecret("GROQ_API_KEY", "v")).toThrow("Keychain is unavailable");
  });
});

describe("migrateSecretsToKeychain", () => {
  test("moves each legacy row and clears it only after the read-back", () => {
    legacyRow("IG_GRAPH_TOKEN", "graph-plain-token");
    legacyRow("IG_PASSWORD::acc-1", "acct-plain-password");
    expect(store.migrateSecretsToKeychain()).toEqual({ moved: ["IG_GRAPH_TOKEN", "IG_PASSWORD::acc-1"], failed: [] });
    expect(db.select().from(tables.secrets).all()).toEqual([]);
    expect(store.getSecret("IG_GRAPH_TOKEN")).toBe("graph-plain-token");
    expect(store.getSecret("IG_PASSWORD::acc-1")).toBe("acct-plain-password");
    expect(allStoredText()).not.toMatch(/graph-plain-token|acct-plain-password/);
  });

  test("a failed keychain write keeps the row and reports it", () => {
    legacyRow("IG_GRAPH_TOKEN", "graph-plain-token");
    setSecretStore(brokenKeychain({ encryptString: () => { throw new Error("user denied keychain access"); } }));
    expect(store.migrateSecretsToKeychain()).toEqual({ moved: [], failed: [{ name: "IG_GRAPH_TOKEN", reason: "user denied keychain access" }] });
    expect(db.select({ value: tables.secrets.value }).from(tables.secrets).all()).toEqual([{ value: "graph-plain-token" }]);
    expect(store.getSecret("IG_GRAPH_TOKEN")).toBe("graph-plain-token");
  });

  test("a read-back that differs keeps the row and stores nothing sealed", () => {
    legacyRow("IG_GRAPH_TOKEN", "graph-plain-token");
    setSecretStore(brokenKeychain({ decryptString: () => "something else" }));
    expect(store.migrateSecretsToKeychain().failed).toEqual([{ name: "IG_GRAPH_TOKEN", reason: "the Keychain read-back did not match, so the secret was not saved" }]);
    expect(db.select().from(tables.secrets).all()).toHaveLength(1);
    expect(db.select().from(tables.sealedSecrets).all()).toEqual([]);
  });

  test("a store that reports a protection gap keeps the row and reports it", () => {
    legacyRow("IG_GRAPH_TOKEN", "graph-plain-token");
    setSecretStore(brokenKeychain({ describeProtectionGap: () => "basic_text backend" }));
    expect(store.migrateSecretsToKeychain().failed).toEqual([{ name: "IG_GRAPH_TOKEN", reason: "the Keychain does not protect secrets on this host (basic_text backend), so the secret was not saved" }]);
    expect(db.select().from(tables.secrets).all()).toHaveLength(1);
    expect(db.select().from(tables.sealedSecrets).all()).toEqual([]);
  });

  test("rerun is a no-op", () => {
    legacyRow("IG_GRAPH_TOKEN", "graph-plain-token");
    store.migrateSecretsToKeychain();
    const sealed = db.select().from(tables.sealedSecrets).all();
    expect(store.migrateSecretsToKeychain()).toEqual({ moved: [], failed: [] });
    expect(db.select().from(tables.sealedSecrets).all()).toEqual(sealed);
  });

  test("an empty legacy row is dropped, not reported", () => {
    legacyRow("IG_USERNAME", "");
    expect(store.migrateSecretsToKeychain()).toEqual({ moved: [], failed: [] });
    expect(db.select().from(tables.secrets).all()).toEqual([]);
  });
});
