import type { VaultItemRow } from "@/server/queries/vault";
import type { RemixSessionRow, RemixStage } from "@/server/services/remix";

export interface DeepLinkSeed {
  /** Which stage the studio should mount into. */
  activeStage: RemixStage;
  /** Fields to persist via `updateStageAction` once on mount, or `null` if nothing
   * needs saving (e.g. no valid id was given, or the only seed is a Hook one — the
   * Hook stage has no persisted "seed" column, see below). */
  sessionPatch: { stage?: RemixStage; styleVaultItemId?: string } | null;
  /** Passed down to `StageHook` as its `initialVaultItemId` prop. */
  hookVaultItemId: string | undefined;
  styleVaultItemId: string | undefined;
}

/**
 * Pure param -> initial-state mapping for a Vault template card's "Use in Remix" deep
 * link (`template-card.tsx`'s `useInRemix()`: `?hook=<vaultItemId>` or
 * `?style=<vaultItemId>`). Kept pure and separate from remix-studio.tsx so the
 * mapping is unit-testable without mounting the component (review finding H2).
 *
 * - An id is only honored if it actually names an item in the vault list passed in —
 *   a stale/deleted-item link is silently ignored rather than half-applied.
 * - The Style stage's seed rides in `sessionPatch.styleVaultItemId` because that's
 *   itself a persisted session column that `StageStyle` already initializes its
 *   Select from (`session.styleVaultItemId ?? SOURCE_VALUE`) — no separate prop
 *   needed, and persisting it is what makes `buildOutlinePrompt`'s server-side read of
 *   `session.styleVaultItemId` actually pick it up too. The Hook stage has no
 *   equivalent persisted "seed" column (`chosenHook` stores the picked hook's
 *   *text*, post-generation, not a vault item id), so its id is returned separately
 *   for remix-studio.tsx to pass down as an ephemeral `initialVaultItemId` prop.
 * - The stepper only *jumps* to the deep-linked stage when the session is "fresh"
 *   (still sitting at stage "prompt" — nothing generated yet). A session with real
 *   progress keeps its current stage; the seed is still returned so it's honored
 *   whenever that stage is actually reached.
 * - If both a hook and a style id are given (the one real entry point only ever sends
 *   one, but this stays defensive), Style wins the jump/activeStage since it's the
 *   later stage — the hook id is still returned so Hook stage is seeded too.
 */
export function resolveDeepLinkSeed(opts: {
  session: RemixSessionRow;
  seedHookVaultItemId?: string;
  seedStyleVaultItemId?: string;
  vaultHooks: VaultItemRow[];
  vaultStyles: VaultItemRow[];
}): DeepLinkSeed {
  const hookVaultItemId =
    opts.seedHookVaultItemId && opts.vaultHooks.some((item) => item.id === opts.seedHookVaultItemId)
      ? opts.seedHookVaultItemId
      : undefined;
  const styleVaultItemId =
    opts.seedStyleVaultItemId && opts.vaultStyles.some((item) => item.id === opts.seedStyleVaultItemId)
      ? opts.seedStyleVaultItemId
      : undefined;

  const targetStage: RemixStage | null = styleVaultItemId ? "style" : hookVaultItemId ? "hook" : null;
  const isFresh = opts.session.stage === "prompt";
  const shouldJump = isFresh && targetStage !== null;

  const patch: { stage?: RemixStage; styleVaultItemId?: string } = {};
  if (shouldJump && targetStage) patch.stage = targetStage;
  if (styleVaultItemId) patch.styleVaultItemId = styleVaultItemId;

  return {
    activeStage: shouldJump && targetStage ? targetStage : opts.session.stage,
    sessionPatch: Object.keys(patch).length > 0 ? patch : null,
    hookVaultItemId,
    styleVaultItemId,
  };
}
