import { redirect } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { WeekTab } from "@/components/week/week-tab";

// Numbers reflect the live local db on every visit; never prerender.
export const dynamic = "force-dynamic";

/** The landing route, Tuần này. Any `?tab=` is an old Dashboard link, which redirects here
 *  without its query. */
export default async function WeekPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  if ((await searchParams).tab !== undefined) redirect("/");
  return (
    <PageContainer>
      <WeekTab />
    </PageContainer>
  );
}
