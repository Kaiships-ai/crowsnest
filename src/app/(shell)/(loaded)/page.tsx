import { CalendarTab } from "@/components/mine/calendar-tab";
import { DashboardTabs, resolveDashboardTab } from "@/components/dashboard/dashboard-tabs";
import { MyReelsTab } from "@/components/mine/my-reels-tab";
import { OverviewTab } from "@/components/dashboard/overview-tab";
import { PageContainer } from "@/components/layout/page-container";

// Numbers reflect the live local db on every visit; never prerender.
export const dynamic = "force-dynamic";

/**
 * The Dashboard: three tabs held in ?tab=. Only the active tab's server component runs,
 * so Overview's sidecar and model pings never run on My reels, and Overview never reads
 * the own-channel tables. readAndBumpDashboardLastVisit lives in OverviewTab alone.
 */
type Param = string | string[] | undefined;
/** A repeated key (?reel=a&reel=b) arrives as an array; the first value wins. */
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: Param; month?: Param; reel?: Param }> }) {
  const params = await searchParams;
  const tab = resolveDashboardTab(first(params.tab));
  const month = first(params.month);
  const reel = first(params.reel);
  return (
    <PageContainer className="flex flex-col gap-8">
      <DashboardTabs active={tab} />
      {tab === "overview" && <OverviewTab />}
      {tab === "reels" && <MyReelsTab reel={reel} />}
      {tab === "calendar" && <CalendarTab month={month} />}
    </PageContainer>
  );
}
