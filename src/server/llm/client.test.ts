import { afterEach, describe, expect, test, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { NoApiKeyError, LlmParseError, getLlm, hasLlmKey, resolveModel, _createLlm } from "./client";

// Snapshot once at module load, restored after every test — this suite mutates
// ANTHROPIC_API_KEY/CLAUDE_MODEL repeatedly and must never leak a fake key into other
// test files sharing this vitest worker (e.g. a later suite asserting keyless-mode UI).
const ORIGINAL_ENV = { ...process.env };

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
    const parse = vi.fn(async () => ({ parsed_output: { answer: "x" } }));
    const llm = _createLlm(fakeAnthropic({ parse }));

    await llm.generateParsed({ system: "sys", user: "hi", schema: Schema });

    const callArg = parse.mock.calls[0][0] as { output_config?: { format?: { type?: string } } };
    expect(callArg.output_config?.format?.type).toBe("json_schema");
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
