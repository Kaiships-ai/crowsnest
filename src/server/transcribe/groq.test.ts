import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// `./groq` reads its key through the keychain store, which imports `@/server/db` at
// module load: CROWSNEST_DB_PATH must be ":memory:" and migrations must run before
// "./groq" is imported, so the read never touches the real on-disk db.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setSecret: typeof import("@/server/secrets/store")["setSecret"];
let GroqProvider: typeof import("./groq")["GroqProvider"];
let groqAvailability: typeof import("./groq")["groqAvailability"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({ GroqProvider, groqAvailability } = await import("./groq"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
  await db.delete(tables.sealedSecrets);
});

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

  test("uses a db-set key even with no GROQ_API_KEY in the env", async () => {
    delete process.env.GROQ_API_KEY;
    setSecret("GROQ_API_KEY", "db-key-456");

    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer db-key-456");
      return new Response(JSON.stringify({ text: "hello from groq" }), { status: 200 });
    });

    const provider = new GroqProvider(fakeFetch as unknown as typeof fetch);
    await provider.transcribe("tests/fixtures/whisper-output.json");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe("groqAvailability", () => {
  test("false when neither db nor env has a key", () => {
    delete process.env.GROQ_API_KEY;
    expect(groqAvailability()).toEqual({ available: false, reason: "GROQ_API_KEY not set" });
  });

  test("true from a db-set key even with no GROQ_API_KEY in the env", () => {
    delete process.env.GROQ_API_KEY;
    setSecret("GROQ_API_KEY", "db-key-456");
    expect(groqAvailability()).toEqual({ available: true });
  });

  test("true from the env when no db row is set", () => {
    process.env.GROQ_API_KEY = "env-key-789";
    expect(groqAvailability()).toEqual({ available: true });
  });
});
