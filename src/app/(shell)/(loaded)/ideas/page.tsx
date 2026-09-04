import { IdeaInbox } from "@/components/ideas/idea-inbox";
import { listIdeas, type IdeaTab } from "@/server/queries/ideas";

// Same reasoning as vault/page.tsx and persona/page.tsx: `searchParams` already opts
// this route out of static rendering, but the ideas loop is single-user/local-SQLite —
// stale inbox contents frozen at build time would be a real bug, not a theoretical one.
export const dynamic = "force-dynamic";

const VALID_TABS: readonly string[] = ["inbox", "shortlist"];

function parseTab(value: string | undefined): IdeaTab {
  return VALID_TABS.includes(value ?? "") ? (value as IdeaTab) : "inbox";
}

// Topbar already renders this route's h1 ("Ideas" — see topbar.tsx's ROUTE_TITLES), so
// page content starts directly at the two-pane inbox, same convention /persona and
// /vault follow.
export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = parseTab(tabParam);
  const items = await listIdeas({ tab });

  return (
    <div className="mx-auto max-w-[1120px] p-6">
      <IdeaInbox items={items} tab={tab} />
    </div>
  );
}
