import { PageContainer } from "@/components/layout/page-container";
import { WeekTab } from "@/components/week/week-tab";

// Numbers reflect the live local db on every visit; never prerender.
export const dynamic = "force-dynamic";

/** The landing route, Tuần này. Old `/?tab=` links are redirected by `src/proxy.ts`. */
export default function WeekPage() {
  return (
    <PageContainer>
      <WeekTab />
    </PageContainer>
  );
}
