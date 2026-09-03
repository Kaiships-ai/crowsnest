import { describe, expect, test } from "vitest";
import { IG_ERROR_CODES, classifyIgError, type IgErrorClass, type IgErrorCode } from "./errors";

/**
 * classifyIgError buckets every code into transient | auth | challenge | fatal for the
 * Goal 3 sync engine. The table below is exhaustive over IG_ERROR_CODES, and the
 * "covers every code" test fails if a code is added without a class here, so the mapping
 * can never silently drift.
 */
const EXPECTED: Record<IgErrorCode, IgErrorClass> = {
  IG_CHALLENGE: "challenge",
  IG_TWO_FACTOR: "challenge",
  IG_AUTH_REQUIRED: "auth",
  IG_BAD_CREDENTIALS: "auth",
  IG_SERVICE_UNAUTHORIZED: "auth",
  IG_RATE_LIMITED: "transient",
  IG_NETWORK: "transient",
  IG_ASSET_DOWNLOAD: "transient",
  IG_SERVICE_DOWN: "transient",
  IG_NOT_FOUND: "fatal",
  IG_ROUTE_NOT_FOUND: "fatal",
  IG_PRIVATE: "fatal",
  IG_PROXY_BLOCKED: "fatal",
  IG_DRIFT: "fatal",
  IG_UNKNOWN: "fatal",
};

describe("classifyIgError", () => {
  for (const code of IG_ERROR_CODES) {
    test(`${code} classifies as ${EXPECTED[code]}`, () => {
      expect(classifyIgError(code)).toBe(EXPECTED[code]);
    });
  }

  test("covers every code in IG_ERROR_CODES", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...IG_ERROR_CODES].sort());
  });
});
