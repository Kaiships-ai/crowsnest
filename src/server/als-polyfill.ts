// Expose AsyncLocalStorage on globalThis before Next's app-render modules load.
//
// Next 16's `app-render/async-local-storage.js` captures `globalThis.AsyncLocalStorage`
// at module-evaluation time (into `maybeGlobalAsyncLocalStorage`), and falls back to a
// `FakeAsyncLocalStorage` whose methods throw when it is absent. Next normally sets the
// global first in `node-environment-baseline.js`, but under a custom `tsx server.ts`
// entrypoint the require hook loads app-render before that baseline runs, so the analysis
// server crashes at boot with:
//
//   Error: Invariant: AsyncLocalStorage accessed in runtime where it is not available
//
// This module has one job: set the global. It must be the FIRST import in `server.ts`,
// before `import next`, so its side effect runs before any Next module is evaluated
// (import side effects run in source order under both ESM and tsx's CJS transform).
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as typeof globalThis & { AsyncLocalStorage?: unknown };
if (typeof g.AsyncLocalStorage !== "function") {
  g.AsyncLocalStorage = AsyncLocalStorage;
}
