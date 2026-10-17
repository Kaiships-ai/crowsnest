import { GraphTokenLine } from "@/components/status/graph-token-line";
import { PageContainer } from "@/components/layout/page-container";
import { SourcesTabs } from "@/components/layout/section-tabs";
import { DiscoverBoard } from "@/components/discover/discover-board";
import { listCreatorSeeds } from "@/server/queries/discover";

// Same reasoning as ideas/page.tsx: the seed list can change (bootstrap, follows) between
// requests and this is single-user/local-SQLite, so a stale build-time snapshot would be a
// real bug — force this route to render fresh every request.
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const seeds = await listCreatorSeeds();
  return (
    <>
      <SourcesTabs />
      <GraphTokenLine className="mx-4 mt-3 mb-0 sm:mx-6" />
      <PageContainer>
        <DiscoverBoard seeds={seeds} />
      </PageContainer>
    </>
  );
}
