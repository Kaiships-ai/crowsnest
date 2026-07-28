import { describe, expect, test } from "vitest";
import { parseRangeHeader, type RangeResult } from "./range";

const SIZE = 4096;

type Case = [name: string, header: string | null, size: number, expected: RangeResult];

const cases: Case[] = [
  // --- absent ---
  ["null header", null, SIZE, { kind: "none" }],
  ["empty header", "", SIZE, { kind: "none" }],
  ["whitespace header", "   ", SIZE, { kind: "none" }],

  // --- ordinary first-last ---
  ["bytes=0-1023", "bytes=0-1023", SIZE, { kind: "satisfiable", start: 0, end: 1023, length: 1024 }],
  ["bytes=1024-2047", "bytes=1024-2047", SIZE, { kind: "satisfiable", start: 1024, end: 2047, length: 1024 }],
  ["single byte bytes=0-0", "bytes=0-0", SIZE, { kind: "satisfiable", start: 0, end: 0, length: 1 }],
  ["last byte", "bytes=4095-4095", SIZE, { kind: "satisfiable", start: 4095, end: 4095, length: 1 }],
  ["whole file explicitly", "bytes=0-4095", SIZE, { kind: "satisfiable", start: 0, end: 4095, length: SIZE }],
  ["end past EOF is clamped", "bytes=4000-999999", SIZE, { kind: "satisfiable", start: 4000, end: 4095, length: 96 }],
  ["absurdly large end clamps", "bytes=0-99999999999999999999", SIZE, { kind: "satisfiable", start: 0, end: 4095, length: SIZE }],
  ["leading zeros are digits", "bytes=0000-0001", SIZE, { kind: "satisfiable", start: 0, end: 1, length: 2 }],
  ["case-insensitive unit", "BYTES=0-9", SIZE, { kind: "satisfiable", start: 0, end: 9, length: 10 }],
  ["whitespace around the spec", "bytes= 0-9 ", SIZE, { kind: "satisfiable", start: 0, end: 9, length: 10 }],

  // --- open ended ---
  ["bytes=0- serves everything", "bytes=0-", SIZE, { kind: "satisfiable", start: 0, end: 4095, length: SIZE }],
  ["bytes=4000- serves the tail", "bytes=4000-", SIZE, { kind: "satisfiable", start: 4000, end: 4095, length: 96 }],
  ["bytes=4095- serves one byte", "bytes=4095-", SIZE, { kind: "satisfiable", start: 4095, end: 4095, length: 1 }],

  // --- suffix ---
  ["bytes=-500 is the last 500", "bytes=-500", SIZE, { kind: "satisfiable", start: 3596, end: 4095, length: 500 }],
  ["bytes=-1 is the last byte", "bytes=-1", SIZE, { kind: "satisfiable", start: 4095, end: 4095, length: 1 }],
  ["suffix longer than the file clamps to the whole file", "bytes=-99999", SIZE, { kind: "satisfiable", start: 0, end: 4095, length: SIZE }],
  ["suffix of exactly the file size", "bytes=-4096", SIZE, { kind: "satisfiable", start: 0, end: 4095, length: SIZE }],

  // --- unsatisfiable (caller must 416) ---
  ["start at EOF", "bytes=4096-", SIZE, { kind: "unsatisfiable" }],
  ["start past EOF", "bytes=5000-6000", SIZE, { kind: "unsatisfiable" }],
  ["start past EOF, open ended", "bytes=999999-", SIZE, { kind: "unsatisfiable" }],
  ["zero-length suffix identifies no bytes", "bytes=-0", SIZE, { kind: "unsatisfiable" }],

  // --- zero-length file: nothing is satisfiable, but syntax is still syntax ---
  ["empty file, bytes=0-", "bytes=0-", 0, { kind: "unsatisfiable" }],
  ["empty file, bytes=0-100", "bytes=0-100", 0, { kind: "unsatisfiable" }],
  ["empty file, suffix", "bytes=-100", 0, { kind: "unsatisfiable" }],
  ["empty file, garbage is still malformed", "bytes=abc", 0, { kind: "malformed" }],

  // --- malformed (caller must ignore the header and serve 200) ---
  ["multi-range is not supported", "bytes=0-99,200-299", SIZE, { kind: "malformed" }],
  ["multi-range with spaces", "bytes=0-99, 200-299", SIZE, { kind: "malformed" }],
  ["trailing comma", "bytes=0-99,", SIZE, { kind: "malformed" }],
  ["non-bytes unit", "items=0-10", SIZE, { kind: "malformed" }],
  ["seconds unit", "seconds=0-10", SIZE, { kind: "malformed" }],
  ["missing unit", "0-1023", SIZE, { kind: "malformed" }],
  ["no equals sign", "bytes 0-1023", SIZE, { kind: "malformed" }],
  ["no dash", "bytes=1024", SIZE, { kind: "malformed" }],
  ["bare dash", "bytes=-", SIZE, { kind: "malformed" }],
  ["empty spec", "bytes=", SIZE, { kind: "malformed" }],
  ["last before first", "bytes=500-100", SIZE, { kind: "malformed" }],
  ["negative start", "bytes=-500-100", SIZE, { kind: "malformed" }],
  ["non-numeric", "bytes=abc-def", SIZE, { kind: "malformed" }],
  ["float offsets", "bytes=0.5-10", SIZE, { kind: "malformed" }],
  ["hex offsets", "bytes=0x10-0x20", SIZE, { kind: "malformed" }],
  ["signed start", "bytes=+10-20", SIZE, { kind: "malformed" }],
  ["internal whitespace", "bytes=0 - 10", SIZE, { kind: "malformed" }],
  ["pure garbage", "not a range at all", SIZE, { kind: "malformed" }],
];

describe("parseRangeHeader", () => {
  test.each(cases)("%s", (_name, header, size, expected) => {
    expect(parseRangeHeader(header, size)).toEqual(expected);
  });

  test("undefined behaves like an absent header", () => {
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: "none" });
  });

  test("every satisfiable result is self-consistent and inside the file", () => {
    for (const [, header, size] of cases) {
      const result = parseRangeHeader(header, size);
      if (result.kind !== "satisfiable") continue;
      expect(result.start).toBeGreaterThanOrEqual(0);
      expect(result.end).toBeLessThan(size);
      expect(result.start).toBeLessThanOrEqual(result.end);
      expect(result.length).toBe(result.end - result.start + 1);
    }
  });

  test("rejects an impossible size rather than computing nonsense", () => {
    expect(() => parseRangeHeader("bytes=0-10", -1)).toThrow(RangeError);
    expect(() => parseRangeHeader("bytes=0-10", Number.NaN)).toThrow(RangeError);
  });
});
