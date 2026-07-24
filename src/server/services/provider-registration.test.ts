import { describe, expect, test } from "vitest";

/**
 * Regression test for whole-branch review finding C1: apify.ts / hikerapi.ts
 * self-register into providers/registry.ts's module-level Map via a bottom-of-file
 * side effect, but nothing in the real module graph reachable from the app's actual
 * entry point (sync-actions.ts -> sync-engine.ts -> registry.ts) used to import either
 * file — so in production, `getProviderChain()` always resolved empty regardless of
 * which env keys were set. Real `APIFY_TOKEN`/`HIKERAPI_KEY` values were silently inert.
 *
 * This file is deliberately its own test file (not folded into sync-engine.test.ts):
 * vitest gives every test file a fresh, isolated module graph, so the `import` below is
 * genuinely the first time anything in this process has touched sync-engine.ts's module
 * graph — exactly reproducing what happens when the real app boots and a server action
 * calls into it, with no risk of another test's fakes/registrations bleeding in.
 */
describe("provider registration wiring", () => {
  test("importing sync-engine.ts (the module graph sync-actions.ts pulls in) registers apify-apidojo and hikerapi for real, so getProviderChain resolves non-empty when a key is set", async () => {
    // Exactly what sync-actions.ts imports — if this doesn't trigger apify.ts/hikerapi.ts's
    // self-registration, neither does the real app.
    await import("./sync-engine");
    const { getProviderChain } = await import("../providers/registry");

    const apifyOnly = getProviderChain({ APIFY_TOKEN: "fake-token-for-test" });
    expect(apifyOnly.length).toBeGreaterThan(0);
    expect(apifyOnly.map((p) => p.name)).toContain("apify-apidojo");

    const hikerOnly = getProviderChain({ HIKERAPI_KEY: "fake-key-for-test" });
    expect(hikerOnly.length).toBeGreaterThan(0);
    expect(hikerOnly.map((p) => p.name)).toContain("hikerapi");

    const both = getProviderChain({ APIFY_TOKEN: "fake-token-for-test", HIKERAPI_KEY: "fake-key-for-test" });
    expect(both.map((p) => p.name)).toEqual(["apify-apidojo", "hikerapi"]);

    // The bug this guards against: with no keys at all, the chain must still be empty —
    // proving this isn't a test that trivially passes by always registering.
    expect(getProviderChain({})).toEqual([]);
  });
});
