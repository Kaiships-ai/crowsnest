import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { downloadToTmp } from "../lib/exec";
import type { TranscriptProvider } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** True iff GROQ_API_KEY is set — Groq has no local binary/model to detect. */
export function groqAvailability(env: NodeJS.ProcessEnv = process.env): { available: boolean; reason?: string } {
  return env.GROQ_API_KEY ? { available: true } : { available: false, reason: "GROQ_API_KEY not set" };
}

export class GroqProvider implements TranscriptProvider {
  readonly name = "groq-whisper";

  // fetch is injectable for tests (no live API calls in tests); defaults to the global.
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async transcribe(videoUrlOrPath: string): Promise<{ text: string; language?: string; durationSec: number }> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not set");

    const isRemote = isUrl(videoUrlOrPath);
    const filePath = isRemote ? await downloadToTmp(videoUrlOrPath) : videoUrlOrPath;
    try {
      const fileBuffer = await readFile(filePath);
      const form = new FormData();
      form.append("model", GROQ_MODEL);
      // verbose_json hands back a real `duration` alongside `text`; still satisfies any
      // caller that only reads `.text` from the plain-json shape.
      form.append("response_format", "verbose_json");
      form.append("file", new Blob([new Uint8Array(fileBuffer)]), path.basename(filePath));

      const res = await this.fetchImpl(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const bodySnippet = await res.text().catch(() => "");
        throw new Error(`groq: HTTP ${res.status} - ${bodySnippet.slice(0, 200)}`);
      }
      const data = (await res.json()) as { text?: string; duration?: number; language?: string };
      return {
        text: typeof data.text === "string" ? data.text : "",
        language: typeof data.language === "string" ? data.language : undefined,
        durationSec: typeof data.duration === "number" ? data.duration : 0,
      };
    } finally {
      if (isRemote) await unlink(filePath).catch(() => {});
    }
  }
}
