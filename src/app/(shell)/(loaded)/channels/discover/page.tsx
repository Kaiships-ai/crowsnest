import { PageContainer } from "@/components/layout/page-container";
import { DiscoverBoard } from "@/components/discover/discover-board";
import { listCreatorSeeds } from "@/server/queries/discover";

// Same reasoning as ideas/page.tsx: the seed list can change (bootstrap, follows) between
// requests and this is single-user/local-SQLite, so a stale build-time snapshot would be a
// real bug — force this route to render fresh every request.
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const seeds = await listCreatorSeeds();
  return (
    <PageContainer>
      <DiscoverBoard seeds={seeds} />
    </PageContainer>
  );
}
