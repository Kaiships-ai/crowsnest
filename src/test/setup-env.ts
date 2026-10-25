import { setSecretStore } from "../shared/secret-store";

/**
 * Global vitest setup (registered via `test.setupFiles` in vitest.config.ts).
 *
 * Runs in-process before each test file's own imports are evaluated, which is what
 * guarantees `src/server/db/index.ts` reads CROWSNEST_DB_PATH=":memory:" at its
 * module-load time rather than the real `data/crowsnest.db` on disk.
 *
 * Before this file existed, only tests that explicitly imported the db module set
 * CROWSNEST_DB_PATH themselves (see the `beforeAll` pattern in e.g.
 * src/server/queries/feed.test.ts). Tests that never intended to touch a database
 * (e.g. src/server/actions/ig-actions.test.ts, src/server/actions/graph-actions.test.ts
 * — both mock the sidecar and never set the env var) still call `log.info/warn/error`
 * as part of the code under test, and since Task 2 wired the logger to also insert a
 * row via `@/server/logs/store` -> `@/server/db`, those calls were silently writing to
 * the real dev database.
 *
 * `??=` so a test (or its own beforeAll) that deliberately sets a different value
 * still wins — this only supplies a default.
 */
process.env.CROWSNEST_DB_PATH ??= ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";
process.env.LOG_LEVEL ??= "error"; // quiet info/warn in tests; a test can override to assert a log line

/** A fake keychain: tests never touch the real one. The sealed form reverses the bytes,
 *  so a stored value never contains the plaintext. */
setSecretStore({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, "utf8").reverse(),
  decryptString: (cipher) => Buffer.from(cipher).reverse().toString("utf8"),
  describeProtectionGap: () => null,
});

/**
 * jsdom shims, guarded so the ~128 node-environment test files are untouched.
 *
 * jsdom implements neither `matchMedia` nor `ResizeObserver`. `useIsMobile`
 * (src/hooks/use-mobile.ts) calls `window.matchMedia` unguarded and
 * `SidebarProvider` (src/components/ui/sidebar.tsx) calls `useIsMobile`, so
 * without this no test can mount the app shell. Recharts measures with a
 * `ResizeObserver`.
 */
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}
