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
      <p data-lab className="px-2 pb-2 text-2xs text-faint">
        Fleets
      </p>

      <Link
        href={hrefFor(null)}
        className={cn(
          "flex items-center justify-between px-2 py-1.5 text-sm",
          !activeFleet
            ? "bg-popover text-foreground"
            : "text-muted-foreground hover:bg-popover/60 hover:text-foreground"
        )}
      >
        <span>All channels</span>
        <span data-num className="font-mono text-2xs text-muted-foreground">
          {totalChannels}
        </span>
      </Link>

      {fleets.map((fleet) => (
        <Link
          key={fleet.id}
          href={hrefFor(fleet.id)}
          className={cn(
            "flex items-center justify-between px-2 py-1.5 text-sm",
            activeFleet === fleet.id
              ? "bg-popover text-foreground"
              : "text-muted-foreground hover:bg-popover/60 hover:text-foreground"
          )}
        >
          <span className="truncate">{fleet.name}</span>
          <span data-num className="font-mono text-2xs text-muted-foreground">
            {fleet.channelCount}
          </span>
        </Link>
      ))}

      <NewFleetDialog />
    </aside>
  );
}
