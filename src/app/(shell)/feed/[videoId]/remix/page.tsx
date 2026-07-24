import { notFound } from "next/navigation";

import { RemixStudio } from "@/components/remix/remix-studio";
import { hasLlmKey } from "@/server/llm/client";
import { getVaultItems } from "@/server/queries/vault";
import { getVideoDetail } from "@/server/queries/video";
import { getNicheProfile, getOrCreateSession } from "@/server/services/remix";

export default async function RemixStudioPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;

  const detail = await getVideoDetail(videoId);
  if (!detail) notFound();

  const [session, vaultHooks, vaultStyles, niche] = await Promise.all([
    getOrCreateSession(videoId),
    getVaultItems("hook"),
    getVaultItems("style"),
    getNicheProfile(),
  ]);

  return (
    <RemixStudio
      detail={detail}
      initialSession={session}
      hasLlmKey={hasLlmKey()}
      vaultHooks={vaultHooks}
      vaultStyles={vaultStyles}
      niche={niche}
    />
  );
}
