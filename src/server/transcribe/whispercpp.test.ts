import { describe, expect, test } from "vitest";
import { parseWhisperJson } from "./whispercpp";
import whisperFixture from "../../../tests/fixtures/whisper-output.json";

describe("parseWhisperJson", () => {
  test("joins trimmed segment text and computes total duration from the last offset", () => {
    const result = parseWhisperJson(whisperFixture);
    expect(result.text).toBe("Stop scrolling if you post reels. Here are three mistakes killing your growth.");
    expect(result.durationSec).toBe(8.2);
  });

  test("empty transcription array -> empty text, 0 duration", () => {
    const result = parseWhisperJson({ transcription: [] });
    expect(result.text).toBe("");
    expect(result.durationSec).toBe(0);
  });

  test("malformed input does not throw", () => {
    expect(() => parseWhisperJson(null)).not.toThrow();
    expect(() => parseWhisperJson("garbage")).not.toThrow();
    const result = parseWhisperJson(undefined);
    expect(result.text).toBe("");
    expect(result.durationSec).toBe(0);
  });
});
