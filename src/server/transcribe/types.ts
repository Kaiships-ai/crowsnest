// Re-exported from providers/types so transcript-pipeline code doesn't reach into
// src/server/providers/** directly — `TranscriptProvider` is the DATA.md §3 interface,
// copied verbatim there; this module is just its front door for src/server/transcribe/**.
export type { TranscriptProvider } from "../providers/types";
