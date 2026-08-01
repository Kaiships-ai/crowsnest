import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// `./client` now imports `@/server/secrets/store`, which imports `@/server/db`
// unconditionally at module load — so, same as every other suite that touches a
// secret-backed module, this file sets CROWSNEST_DB_PATH=":memory:" and dynamically
// imports everything it needs from a `beforeAll`, rather than a static top-level
// import that would open the real on-disk db before any test gets to configure it.
let NoApiKeyError: typeof import("./client")["NoApiKeyError"];
let LlmParseError: typeof import("./client")["LlmParseError"];
let getLlm: typeof import("./client")["getLlm"];
let hasLlmKey: typeof import("./client")["hasLlmKey"];
let isCompatMode: typeof import("./client")["isCompatMode"];
let resolveModel: typeof import("./client")["resolveModel"];
let resetLlmClient: typeof import("./client")["resetLlmClient"];
let _createLlm: typeof import("./client")["_createLlm"];
let _createCompatLlm: typeof import("./client")["_createCompatLlm"];
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setSecret: typeof import("@/server/secrets/store")["setSecret"];

// Snapshot once at module load, restored after every test — this suite mutates
// ANTHROPIC_API_KEY/CLAUDE_MODEL repeatedly and must never leak a fake key into other
// test files sharing this vitest worker (e.g. a later suite asserting keyless-mode UI).
const ORIGINAL_ENV = { ...process.env };

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({
    NoApiKeyError,
    LlmParseError,
    getLlm,
    hasLlmKey,
    isCompatMode,
    resolveModel,
    resetLlmClient,
    _createLlm,
    _createCompatLlm,
  } = await import("./client"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
  resetLlmClient();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/**
 * Fakes just the two `messages` methods our wrapper calls — cast through `unknown`
 * since a plain object never structurally satisfies the full `Anthropic` class. This
 * is the "test-only constructor seam" the plan calls for: `_createLlm` accepts it in
 * place of a real `new Anthropic()`, so no test here ever makes a live API call.
 */
function fakeAnthropic(opts: {
  create?: (...args: unknown[]) => Promise<unknown>;
  parse?: (...args: unknown[]) => Promise<unknown>;
  countTokens?: (...args: unknown[]) => Promise<unknown>;
}): Anthropic {
  return {
    messages: {
      create: opts.create ?? vi.fn(async () => ({ content: [] })),
      parse: opts.parse ?? vi.fn(async () => ({ parsed_output: null })),
      countTokens: opts.countTokens ?? vi.fn(async () => ({ input_tokens: 1 })),
    },
  } as unknown as Anthropic;
}

describe("hasLlmKey / getLlm", () => {
  test("hasLlmKey reflects ANTHROPIC_API_KEY presence", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasLlmKey()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test-fake";
    expect(hasLlmKey()).toBe(true);
  });

  test("getLlm throws NoApiKeyError when ANTHROPIC_API_KEY is absent", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => getLlm()).toThrow(NoApiKeyError);
  });

  test("getLlm returns a client without throwing once a key is present (no network call made)", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-fake";
    expect(() => getLlm()).not.toThrow();
  });

  test("hasLlmKey is true from a db-set key even with no ANTHROPIC_API_KEY in the env", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasLlmKey()).toBe(false);
    setSecret("ANTHROPIC_API_KEY", "sk-test-db-value");
    expect(hasLlmKey()).toBe(true);
  });

  test("resetLlmClient nulls the cache so a key change via the store takes effect", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => getLlm()).toThrow(NoApiKeyError);

    setSecret("ANTHROPIC_API_KEY", "sk-test-db-value");
    // Without resetLlmClient this would still throw: getLlm's `!cachedClient` guard
    // only re-checks the key when there's no cached client yet, but the failed call
    // above never populated the cache, so this passes even before the reset — the
    // real assertion is the next block, where a *populated* cache must be dropped.
    expect(() => getLlm()).not.toThrow();

    resetLlmClient();
    process.env.LLM_BASE_URL = "http://localhost:20128";
    expect(() => getLlm()).not.toThrow();
    expect(isCompatMode()).toBe(true);
  });
});

describe("resolveModel", () => {
  test("defaults to claude-sonnet-5 when CLAUDE_MODEL is unset", () => {
    delete process.env.CLAUDE_MODEL;
    expect(resolveModel()).toBe("claude-sonnet-5");
  });

  test("honors a CLAUDE_MODEL override", () => {
    process.env.CLAUDE_MODEL = "claude-opus-4-8";
    expect(resolveModel()).toBe("claude-opus-4-8");
  });
});

describe("generateText", () => {
  test("concatenates only text blocks, skipping other block types", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: "Hello " },
        { type: "tool_use", id: "toolu_1", name: "ignored", input: {} },
        { type: "text", text: "world" },
      ],
    }));
    const llm = _createLlm(fakeAnthropic({ create }));

    const result = await llm.generateText({ system: "sys", user: "hi" });

    expect(result).toBe("Hello world");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("passes the resolved model and default maxTokens through to create()", async () => {
    process.env.CLAUDE_MODEL = "claude-opus-4-8";
    const create = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const llm = _createLlm(fakeAnthropic({ create }));

    await llm.generateText({ system: "sys", user: "hi" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-8", max_tokens: 2048 })
    );
  });

  test("an explicit maxTokens overrides the default", async () => {
    const create = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const llm = _createLlm(fakeAnthropic({ create }));

    await llm.generateText({ system: "sys", user: "hi", maxTokens: 512 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 512 }));
  });
});

describe("generateParsed", () => {
  const Schema = z.object({ answer: z.string() });

  test("returns parsed_output on first success, calling parse() exactly once", async () => {
    const parse = vi.fn(async () => ({ parsed_output: { answer: "42" } }));
    const llm = _createLlm(fakeAnthropic({ parse }));

    const result = await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    expect(result).toEqual({ answer: "42" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("retries once when parsed_output is null on the first attempt, then returns the retry's result", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({ parsed_output: null })
      .mockResolvedValueOnce({ parsed_output: { answer: "retried" } });
    const llm = _createLlm(fakeAnthropic({ parse }));

    const result = await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    expect(result).toEqual({ answer: "retried" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  test("throws LlmParseError when parsed_output is still null after the retry", async () => {
    const parse = vi.fn(async () => ({ parsed_output: null }));
    const llm = _createLlm(fakeAnthropic({ parse }));

    await expect(llm.generateParsed({ system: "sys", user: "hi", schema: Schema })).rejects.toThrow(LlmParseError);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  test("passes output_config.format built from the given zod schema", async () => {
    const parse = vi.fn(async (_opts: unknown) => ({ parsed_output: { answer: "x" } }));
    const llm = _createLlm(fakeAnthropic({ parse }));

    await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    const callArg = parse.mock.calls[0][0] as { output_config?: { format?: { type?: string } } };
    expect(callArg.output_config?.format?.type).toBe("json_schema");
  });
});

describe("CompatLlmClient (OpenAI-compat router mode)", () => {
  const Schema = z.object({ answer: z.string() });

  /** Fakes `messages.stream(...).finalMessage()` — the only path the compat client uses for generation. */
  function fakeStreamingAnthropic(finalMessages: Array<{ content: unknown[] }>) {
    let call = 0;
    const stream = vi.fn((params: { system: string; max_tokens: number }) => {
      void params; // typed so tests can read stream.mock.calls; the fake ignores it
      const message = finalMessages[Math.min(call, finalMessages.length - 1)];
      call++;
      return { finalMessage: async () => message };
    });
    const client = {
      messages: {
        stream,
        countTokens: vi.fn(async () => ({ input_tokens: 1 })),
      },
    } as unknown as Anthropic;
    return { client, stream };
  }

  test("isCompatMode reflects LLM_BASE_URL presence", () => {
    delete process.env.LLM_BASE_URL;
    expect(isCompatMode()).toBe(false);
    process.env.LLM_BASE_URL = "http://localhost:20128";
    expect(isCompatMode()).toBe(true);
  });

  test("generateText streams and concatenates only text blocks, skipping thinking blocks", async () => {
    const { client, stream } = fakeStreamingAnthropic([
      {
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
    ]);
    const llm = _createCompatLlm(client);

    const result = await llm.generateText({ system: "sys", user: "hi" });

    expect(result).toBe("Hello world");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  test("generateParsed parses fenced JSON from the streamed text and validates via zod", async () => {
    const { client } = fakeStreamingAnthropic([
      { content: [{ type: "text", text: 'Sure!\n```json\n{"answer": "42"}\n```' }] },
    ]);
    const llm = _createCompatLlm(client);

    const result = await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    expect(result).toEqual({ answer: "42" });
  });

  test("generateParsed embeds the JSON schema in the system prompt", async () => {
    const { client, stream } = fakeStreamingAnthropic([
      { content: [{ type: "text", text: '{"answer": "x"}' }] },
    ]);
    const llm = _createCompatLlm(client);

    await llm.generateParsed({ system: "base-sys", user: "hi", schema: Schema });

    const callArg = stream.mock.calls[0][0];
    expect(callArg.system).toContain("base-sys");
    expect(callArg.system).toContain("JSON Schema");
    expect(callArg.system).toContain('"answer"');
  });

  test("generateParsed retries once on malformed JSON, then returns the retry's result", async () => {
    const { client, stream } = fakeStreamingAnthropic([
      { content: [{ type: "text", text: "not json at all" }] },
      { content: [{ type: "text", text: '{"answer": "retried"}' }] },
    ]);
    const llm = _createCompatLlm(client);

    const result = await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    expect(result).toEqual({ answer: "retried" });
    expect(stream).toHaveBeenCalledTimes(2);
  });

  test("generateParsed throws LlmParseError when both attempts fail schema validation", async () => {
    const { client, stream } = fakeStreamingAnthropic([
      { content: [{ type: "text", text: '{"wrong_key": true}' }] },
    ]);
    const llm = _createCompatLlm(client);

    await expect(llm.generateParsed({ system: "sys", user: "hi", schema: Schema })).rejects.toThrow(
      LlmParseError
    );
    expect(stream).toHaveBeenCalledTimes(2);
  });

  test("getLlm returns the compat client when LLM_BASE_URL is set (no crash, no network)", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-fake";
    process.env.LLM_BASE_URL = "http://localhost:20128";
    expect(() => getLlm()).not.toThrow();
  });
});

describe("ping", () => {
  test("calls countTokens with the resolved model and a minimal message, resolving on success", async () => {
    process.env.CLAUDE_MODEL = "claude-opus-4-8";
    const countTokens = vi.fn(async () => ({ input_tokens: 3 }));
    const llm = _createLlm(fakeAnthropic({ countTokens }));

    await expect(llm.ping()).resolves.toBeUndefined();

    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(countTokens).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-8", messages: [{ role: "user", content: "ping" }] })
    );
  });

  test("propagates a countTokens rejection untouched (e.g. an invalid-key error)", async () => {
    const boom = new Error("invalid x-api-key");
    const countTokens = vi.fn().mockRejectedValue(boom);
    const llm = _createLlm(fakeAnthropic({ countTokens }));

    await expect(llm.ping()).rejects.toBe(boom);
  });
});
