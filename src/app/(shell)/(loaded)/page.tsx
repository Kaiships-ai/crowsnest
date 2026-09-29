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
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; reel?: string }> }) {
  const { tab: rawTab, month, reel } = await searchParams;
  const tab = resolveDashboardTab(rawTab);
  return (
    <PageContainer className="flex flex-col gap-8">
      <DashboardTabs active={tab} />
      {tab === "overview" && <OverviewTab />}
      {tab === "reels" && <MyReelsTab reel={reel} />}
      {tab === "calendar" && <CalendarTab month={month} />}
    </PageContainer>
  );
}
