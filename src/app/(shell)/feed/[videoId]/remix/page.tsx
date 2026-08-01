import { notFound } from "next/navigation";

import { RemixStudio } from "@/components/remix/remix-studio";
import { hasLlmKey } from "@/server/llm/client";
import { getSavedPosts } from "@/server/queries/saved-posts";
import { getVaultItems } from "@/server/queries/vault";
import { getVideoDetail } from "@/server/queries/video";
import { getNicheProfile, getOrCreateSession } from "@/server/services/remix";

// Read-only reference material for the blocked surface (v1-scope.md: "a recovery
// action that names the command to start the proxy"). No command to start an
// external process exists in this repo, so this is the honest half of that this
// app can name — where it looked. Never used to decide whether generation runs;
// that decision stays server-side in llm/client.ts's own hasLlmKey()/getLlm().
const LLM_PROXY_URL = process.env.LLM_BASE_URL ?? null;

// Capped the same way the "similar tracked outliers" list already is (services/
// remix.ts's buildResearch calls getSimilarOutliers(id, 5)) — a reference rail, not
// the whole Vault.
const RESEARCH_VAULT_LIMIT = 5;

export default async function RemixStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  // Vault template-card deep link (template-card.tsx's useInRemix): ?hook=<id> or
  // ?style=<id> pre-selects that Vault item in the matching stage (review finding H2).
  searchParams: Promise<{ hook?: string; style?: string }>;
}) {
  const { videoId } = await params;

  const detail = await getVideoDetail(videoId);
  if (!detail) notFound();

  const [session, vaultHooks, vaultStyles, savedPosts, niche, { hook, style }] = await Promise.all([
    getOrCreateSession(videoId),
    getVaultItems("hook"),
    getVaultItems("style"),
    getSavedPosts("recent"),
    getNicheProfile(),
    searchParams,
  ]);

  return (
    <RemixStudio
      detail={detail}
      initialSession={session}
      hasLlmKey={hasLlmKey()}
      vaultHooks={vaultHooks}
      vaultStyles={vaultStyles}
      vaultSavedPosts={savedPosts.slice(0, RESEARCH_VAULT_LIMIT)}
      niche={niche}
      llmProxyUrl={LLM_PROXY_URL}
      seedHookVaultItemId={hook}
      seedStyleVaultItemId={style}
    />
  );
}
