import { beforeAll, describe, expect, test } from "vitest";
import type { LlmClient } from "./client";

let probeLlmGeneration: typeof import("./generation-probe")["probeLlmGeneration"];

beforeAll(async () => {
  // `./generation-probe` imports `getLlm` from `./client`, which imports `getSecret`
  // from `@/server/secrets/store`, which imports the db — even though every test below
  // except the last passes its own fake `LlmClient` and so never actually calls
  // `getLlm()`. `src/test/setup-env.ts` (vitest's global setupFiles) already points
  // `CROWSNEST_DB_PATH` at `:memory:` before this file's imports run, same as every
  // other test in this repo that touches a server module transitively wired to the db.
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  ({ probeLlmGeneration } = await import("./generation-probe"));
});

/** A minimal fake `LlmClient` — only `ping` and `generateText` are ever called by the
 *  probe, so `generateParsed` is a stub that should never be reached. */
function fakeClient(overrides: Partial<LlmClient>): LlmClient {
  return {
    generateText: overrides.generateText ?? (() => Promise.reject(new Error("not stubbed"))),
    generateParsed: () => Promise.reject(new Error("generateParsed should never be called by the generation probe")),
    ping: overrides.ping ?? (() => Promise.reject(new Error("not stubbed"))),
  };
}

describe("probeLlmGeneration", () => {
  test('reports "up" when generation actually returns text', async () => {
    const client = fakeClient({
      ping: () => Promise.resolve(),
      generateText: () => Promise.resolve("OK"),
    });

    const result = await probeLlmGeneration(client);

    expect(result).toEqual({ state: "up", detail: null });
  });

  test('reports "down" when nothing answers at all', async () => {
    const client = fakeClient({
      ping: () => Promise.reject(new Error("Network error reaching Claude")),
      generateText: () => Promise.reject(new Error("Network error reaching Claude")),
    });

    const result = await probeLlmGeneration(client);

    expect(result.state).toBe("down");
    expect(result.detail).toBeTruthy();
  });

  test('reports "reachable_unverified" when the proxy answers count_tokens but generation fails — the exact false-green gap dependency-status.ts names', async () => {
    const client = fakeClient({
      ping: () => Promise.resolve(),
      generateText: () => Promise.reject(new Error("410 Gone")),
    });

    const result = await probeLlmGeneration(client);

    expect(result).toEqual({ state: "reachable_unverified", detail: "410 Gone" });
  });

  test('reports "reachable_unverified" when generation resolves but returns no usable text', async () => {
    const client = fakeClient({
      ping: () => Promise.resolve(),
      generateText: () => Promise.resolve("   "),
    });

    const result = await probeLlmGeneration(client);

    expect(result).toEqual({ state: "reachable_unverified", detail: "generation returned no text" });
  });

  test('reports "down" with a friendly message when no API key is configured (no fake given, real getLlm() path)', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await probeLlmGeneration();

    expect(result.state).toBe("down");
    expect(result.detail).toBe("ANTHROPIC_API_KEY is not set — add it in Settings to enable AI features.");
  });
});
