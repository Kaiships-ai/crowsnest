import Link from "next/link";
import { Button } from "@/components/ui/button";

export type DashboardTab = "overview" | "reels" | "calendar";

export function resolveDashboardTab(raw: string | string[] | undefined): DashboardTab {
  return raw === "reels" || raw === "calendar" ? raw : "overview";
}

const TABS: { id: DashboardTab; label: string; testId: string }[] = [
  { id: "overview", label: "Overview", testId: "dashboard-tab-overview" },
  { id: "reels", label: "My reels", testId: "dashboard-tab-reels" },
  { id: "calendar", label: "Calendar", testId: "dashboard-tab-calendar" },
];

/** Links, not client tabs: the tab lives in ?tab= so a reload or shared link lands on it,
 *  and the server renders only that tab's reads. */
export function DashboardTabs({ active }: { active: DashboardTab }) {
  return (
    <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant={t.id === active ? "secondary" : "ghost"}
          aria-current={t.id === active ? "page" : undefined}
          data-testid={t.testId}
          render={<Link href={`/?tab=${t.id}`} />}
        >
          {t.label}
        </Button>
      ))}
    </nav>
  );
}
