---
name: crowsnest-test-heap-leaks
description: Investigate JS heap growth, RSS spikes, and Vitest OOMs in the crowsnest Next app and its tests. Trigger:/crowsnest-test-heap-leaks
---

# crowsnest test heap leaks

Find and fix memory that grows without bound in the Next server (`tsx server.ts`) and in `npm test` (vitest) runs: rising RSS across a run, heap-snapshot deltas that never settle, and OOM crashes.

TODO: port from openclaw-test-heap-leaks (pnpm test heap snapshot deltas, RSS tracking). Map to `npm test` / vitest and `server.ts`. Flesh out later.
