import { notFound } from "next/navigation";

import { StudioScreen } from "@/components/studio/studio-screen";
import { getStudioBrief } from "@/server/queries/studio";

// Same reason as feed/[videoId]/remix/page.tsx and (shell)/layout.tsx: `getStudioBrief`
// reads plannedPosts/videos live on every visit, so this route must never be frozen at
// build time.
export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const brief = await getStudioBrief(postId);
  if (!brief) notFound();
  return <StudioScreen brief={brief} />;
}
