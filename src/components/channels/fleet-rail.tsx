"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Fleet } from "@/server/queries/channels";

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

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled
              focusableWhenDisabled
              className="mt-1 justify-start gap-1.5 text-muted-foreground"
            >
              <Plus className="size-3.5" /> New fleet
            </Button>
          }
        />
        <TooltipContent>Coming with Vault phase</TooltipContent>
      </Tooltip>
    </aside>
  );
}
