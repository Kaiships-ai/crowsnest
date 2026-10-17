import { PageContainer } from "@/components/layout/page-container";
import { INCIDENT_TABS, SectionTabs, SettingsTabs } from "@/components/layout/section-tabs";
import { LogsView } from "@/components/logs/logs-view";
import { queryLogEvents, type LogQueryFilter, type LogSource, type StoredLogLevel } from "@/server/logs/store";

// Never freeze at build time — this route has to read whatever is in log_events at
// request time, the same reason force-dynamic shows up on every other data-backed page
// in this shell (see caching-without-cache-components.md).
export const dynamic = "force-dynamic";

// Same shape channels/page.tsx and feed/page.tsx already use for this Next version's
// searchParams — a Promise-wrapped Record, read with a `first()` helper rather than
// assuming Next hands over single string values.
type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Topbar already renders this route's h1 ("Logs") — see nav-items/topbar's ROUTE_TITLES
// — so page content here starts directly at the filter bar. The heading this page used
// to print was a second h1 on the route AND the same word the topbar shows, so it read
// "Logs" twice down the left edge.
export default async function LogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;

  const levelsRaw = first(sp.levels);
  // `!== undefined` (not a truthiness check) so an explicit empty selection — every
  // level box unchecked — reads as "show nothing", distinct from a bare /logs visit
  // that never set the param at all and falls back to warn and error only.
  const levels = levelsRaw !== undefined
    ? (levelsRaw.split(",").filter(Boolean) as StoredLogLevel[])
    : (["warn", "error"] as StoredLogLevel[]);

  const filter: LogQueryFilter = {
    levels,
    source: first(sp.source) as LogSource | undefined,
    event: first(sp.event),
    since: first(sp.since),
    until: first(sp.until),
    search: first(sp.search),
  };

  const rows = queryLogEvents(filter);

  return (
    <>
      <SettingsTabs />
      <PageContainer className="flex flex-col gap-4">
        <SectionTabs tabs={INCIDENT_TABS} label="Nhật ký sự cố" />
        <LogsView rows={rows} filter={filter} />
      </PageContainer>
    </>
  );
}
