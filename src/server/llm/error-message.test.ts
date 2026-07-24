import { describe, expect, test } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { llmErrorMessage } from "./error-message";

/** Fake response headers — real SDK error constructors take a Headers instance
 * (used internally to read a request-id), not used by llmErrorMessage itself. */
function fakeHeaders(): Headers {
  return new Headers();
}

describe("llmErrorMessage", () => {
  test("AuthenticationError -> friendly key message", () => {
    const err = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      "invalid x-api-key",
      fakeHeaders(),
      "authentication_error"
    );

    expect(llmErrorMessage(err)).toBe("API key invalid or revoked — check Settings");
  });

  test("RateLimitError -> friendly retry message", () => {
    const err = new Anthropic.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
      "slow down",
      fakeHeaders(),
      "rate_limit_error"
    );

    expect(llmErrorMessage(err)).toBe("Rate limited — retry in a moment");
  });

  test("APIConnectionError -> friendly network message", () => {
    const err = new Anthropic.APIConnectionError({ message: "fetch failed" });

    expect(llmErrorMessage(err)).toBe("Network error reaching Claude");
  });

  test("a generic APIError subclass -> status + type (stands in for the finding's 'APIStatusError' — no such class exists in the TS SDK)", () => {
    const err = new Anthropic.NotFoundError(
      404,
      { type: "error", error: { type: "not_found_error", message: "no such model" } },
      "no such model",
      fakeHeaders(),
      "not_found_error"
    );

    const message = llmErrorMessage(err);
    expect(message).toContain("404");
    expect(message).toContain("not_found_error");
  });

  test("most-specific-first: AuthenticationError is not swallowed by the generic APIError branch", () => {
    const err = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid" } },
      "invalid",
      fakeHeaders(),
      "authentication_error"
    );

    const message = llmErrorMessage(err);
    expect(message).toBe("API key invalid or revoked — check Settings");
    expect(message).not.toContain("401");
  });

  test("a plain Error falls back to its own message", () => {
    expect(llmErrorMessage(new Error("boom"))).toBe("boom");
  });

  test("a non-Error value falls back to String(...)", () => {
    expect(llmErrorMessage("just a string")).toBe("just a string");
  });
});
