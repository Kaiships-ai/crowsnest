import { afterEach, describe, expect, test, vi } from "vitest";
import { GroqProvider } from "./groq";

const ORIGINAL_KEY = process.env.GROQ_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_KEY;
});

describe("GroqProvider.transcribe", () => {
  test("posts a multipart request to the Groq endpoint with the right auth + model, maps text response", async () => {
    process.env.GROQ_API_KEY = "test-key-123";

    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key-123");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: "hello from groq" }), { status: 200 });
    });

    // A local (non-URL) path — reads real bytes from a repo-committed fixture so no
    // network/yt-dlp download branch is exercised; content doesn't matter, only that
    // the request built from it has the right shape.
    const provider = new GroqProvider(fakeFetch as unknown as typeof fetch);
    const result = await provider.transcribe("tests/fixtures/whisper-output.json");

    expect(result.text).toBe("hello from groq");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  test("throws when GROQ_API_KEY is not set", async () => {
    delete process.env.GROQ_API_KEY;
    const provider = new GroqProvider(vi.fn() as unknown as typeof fetch);
    await expect(provider.transcribe("tests/fixtures/whisper-output.json")).rejects.toThrow(/GROQ_API_KEY/);
  });
});
