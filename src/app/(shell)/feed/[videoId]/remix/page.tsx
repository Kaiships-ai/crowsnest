import { notFound } from "next/navigation";

import { RemixStudio } from "@/components/remix/remix-studio";
import { getSavedPosts } from "@/server/queries/saved-posts";
import { getVaultItems } from "@/server/queries/vault";
import { getVideoDetail } from "@/server/queries/video";
import { getNicheProfile, getOrCreateSession } from "@/server/services/remix";

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
      vaultHooks={vaultHooks}
      vaultStyles={vaultStyles}
      vaultSavedPosts={savedPosts.slice(0, RESEARCH_VAULT_LIMIT)}
      niche={niche}
      seedHookVaultItemId={hook}
      seedStyleVaultItemId={style}
    />
  );
}
