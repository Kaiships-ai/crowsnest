"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import type { Fleet } from "@/server/queries/channels";
import { NewFleetDialog } from "./new-fleet-dialog";

export function FleetRail({ fleets, totalChannels }: { fleets: Fleet[]; totalChannels: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFleet = searchParams.get("fleet");

  function hrefFor(fleetId: string | null): string {
    const params = new URLSearchParams(searchParams.toString());
    if (fleetId) {
      params.set("fleet", fleetId);
    } else {
      params.delete("fleet");
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <aside className="flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border py-4 pr-3">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Fleets</p>

      <Link
        href={hrefFor(null)}
        className={cn(
          "flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
          !activeFleet
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        )}
      >
        <span>All channels</span>
        <span className="text-xs tabular-nums">{totalChannels}</span>
      </Link>

      {fleets.map((fleet) => (
        <Link
          key={fleet.id}
          href={hrefFor(fleet.id)}
          className={cn(
            "flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
            activeFleet === fleet.id
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          )}
        >
          <span className="truncate">{fleet.name}</span>
          <span className="text-xs tabular-nums">{fleet.channelCount}</span>
        </Link>
      ))}

      <NewFleetDialog />
    </aside>
  );
}
