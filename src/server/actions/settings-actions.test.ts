import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { LlmClient } from "../llm/client";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let getNicheSettings: typeof import("./settings-actions")["getNicheSettings"];
let saveNicheSettingsAction: typeof import("./settings-actions")["saveNicheSettingsAction"];
let testAnthropicKeyAction: typeof import("./settings-actions")["testAnthropicKeyAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  ({ getNicheSettings, saveNicheSettingsAction, testAnthropicKeyAction } = await import("./settings-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.appSettings);
});

function fakeLlm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateText: vi.fn(),
    generateParsed: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("getNicheSettings", () => {
  test("returns the fallback niche and empty keywords when nothing has ever been saved", async () => {
    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "general short-form content", keywords: [] });
  });
});

describe("saveNicheSettingsAction", () => {
  test("round-trips niche + keywords through getNicheSettings", async () => {
    const result = await saveNicheSettingsAction("AI productivity tools for solo founders", ["ai", "productivity", "solo"]);
    expect(result).toEqual({ ok: true });

    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "AI productivity tools for solo founders", keywords: ["ai", "productivity", "solo"] });
  });

  test("a second save overwrites the first (update path, not a duplicate-key error)", async () => {
    await saveNicheSettingsAction("first niche", ["a"]);
    const second = await saveNicheSettingsAction("second niche", ["b", "c"]);

    expect(second).toEqual({ ok: true });
    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "second niche", keywords: ["b", "c"] });
  });
});

describe("testAnthropicKeyAction", () => {
  test("ok:true when ping() succeeds", async () => {
    const result = await testAnthropicKeyAction(fakeLlm());
    expect(result).toEqual({ ok: true });
  });

  test("maps a ping() rejection through the shared llmErrorMessage helper", async () => {
    const llm = fakeLlm({ ping: vi.fn().mockRejectedValue(new Error("some transport failure")) });

    const result = await testAnthropicKeyAction(llm);

    expect(result).toEqual({ ok: false, error: "some transport failure" });
  });

  test("no key configured (no fake given, real getLlm() path): a friendly not-set message, no network call", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await testAnthropicKeyAction();

    expect(result).toEqual({ ok: false, error: "ANTHROPIC_API_KEY is not set." });
  });
});
