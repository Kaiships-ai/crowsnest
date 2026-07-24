import { notFound } from "next/navigation";

import { RemixStudio } from "@/components/remix/remix-studio";
import { hasLlmKey } from "@/server/llm/client";
import { getVaultItems } from "@/server/queries/vault";
import { getVideoDetail } from "@/server/queries/video";
import { getNicheProfile, getOrCreateSession } from "@/server/services/remix";

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

  const [session, vaultHooks, vaultStyles, niche, { hook, style }] = await Promise.all([
    getOrCreateSession(videoId),
    getVaultItems("hook"),
    getVaultItems("style"),
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
      niche={niche}
      seedHookVaultItemId={hook}
      seedStyleVaultItemId={style}
    />
  );
}
