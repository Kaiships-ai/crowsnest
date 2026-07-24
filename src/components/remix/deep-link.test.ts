import { describe, expect, test } from "vitest";
import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow } from "@/server/services/remix";
import { resolveDeepLinkSeed } from "./deep-link";

function fakeSession(overrides: Partial<RemixSessionRow> = {}): RemixSessionRow {
  return {
    id: "session-1",
    sourceVideoId: "video-1",
    stage: "prompt",
    topic: null,
    niche: null,
    targetLengthSec: null,
    researchNotes: null,
    hookOptions: null,
    chosenHook: null,
    styleVaultItemId: null,
    outline: null,
    variants: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeVaultItem(id: string, type: "hook" | "style"): VaultItemRow {
  return { id, type, title: `Title ${id}`, templateText: "text", tags: [], createdAt: "2026-01-01T00:00:00.000Z", sourceVideo: null };
}

const VAULT_HOOKS = [fakeVaultItem("hook-1", "hook")];
const VAULT_STYLES = [fakeVaultItem("style-1", "style")];

/** Pure param -> initial-state mapping (review finding H2) for a Vault template
 * card's "Use in Remix" deep link — see deep-link.ts's doc comment for the full
 * rationale behind each branch. A manual click-through from an actual Vault card
 * (verifying real preselection end to end) was additionally run via the browse skill. */
describe("resolveDeepLinkSeed", () => {
  test("fresh session + valid hook id: jumps to Hook stage and persists the stage bump", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "prompt" }),
      seedHookVaultItemId: "hook-1",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("hook");
    expect(result.sessionPatch).toEqual({ stage: "hook" });
    expect(result.hookVaultItemId).toBe("hook-1");
    expect(result.styleVaultItemId).toBeUndefined();
  });

  test("fresh session + valid style id: jumps to Style stage and persists both the stage bump and the seeded styleVaultItemId", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "prompt" }),
      seedStyleVaultItemId: "style-1",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("style");
    expect(result.sessionPatch).toEqual({ stage: "style", styleVaultItemId: "style-1" });
    expect(result.styleVaultItemId).toBe("style-1");
    expect(result.hookVaultItemId).toBeUndefined();
  });

  test("non-fresh session + valid hook id: does not jump; nothing to persist (Hook has no persisted seed column)", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "script" }),
      seedHookVaultItemId: "hook-1",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("script");
    expect(result.sessionPatch).toBeNull();
    expect(result.hookVaultItemId).toBe("hook-1"); // still seeded, for whenever Hook stage is reached
  });

  test("non-fresh session + valid style id: does not jump, but still persists the seeded styleVaultItemId", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "script" }),
      seedStyleVaultItemId: "style-1",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("script");
    expect(result.sessionPatch).toEqual({ styleVaultItemId: "style-1" });
    expect(result.styleVaultItemId).toBe("style-1");
    expect(result.hookVaultItemId).toBeUndefined();
  });

  test("an id that doesn't match any vault item is ignored entirely (stale/bad link)", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "prompt" }),
      seedHookVaultItemId: "does-not-exist",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("prompt");
    expect(result.sessionPatch).toBeNull();
    expect(result.hookVaultItemId).toBeUndefined();
    expect(result.styleVaultItemId).toBeUndefined();
  });

  test("no seed ids given: passthrough, nothing to jump or persist", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "research" }),
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("research");
    expect(result.sessionPatch).toBeNull();
    expect(result.hookVaultItemId).toBeUndefined();
    expect(result.styleVaultItemId).toBeUndefined();
  });

  test("both hook and style ids valid on a fresh session: Style wins the jump, but the hook id is still returned for later", () => {
    const result = resolveDeepLinkSeed({
      session: fakeSession({ stage: "prompt" }),
      seedHookVaultItemId: "hook-1",
      seedStyleVaultItemId: "style-1",
      vaultHooks: VAULT_HOOKS,
      vaultStyles: VAULT_STYLES,
    });

    expect(result.activeStage).toBe("style");
    expect(result.sessionPatch).toEqual({ stage: "style", styleVaultItemId: "style-1" });
    expect(result.hookVaultItemId).toBe("hook-1");
    expect(result.styleVaultItemId).toBe("style-1");
  });
});
