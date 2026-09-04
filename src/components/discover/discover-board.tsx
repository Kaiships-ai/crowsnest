"use client";

import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CreatorSeedRow } from "@/server/queries/discover";
import { CreatorSeedCard } from "./creator-seed-card";

const NICHES = ["all", "fitness", "finance", "tech", "business"] as const;
type Niche = (typeof NICHES)[number];

export function DiscoverBoard({ seeds }: { seeds: CreatorSeedRow[] }) {
  const [niche, setNiche] = useState<Niche>("all");
  // Lives here, not in CreatorSeedCard: a niche-filter switch unmounts cards
  // whose niche no longer matches, which would wipe card-local follow state.
  // This board stays mounted across filter changes, so a followed handle
  // survives its card's unmount/remount.
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const filtered = useMemo(
    () => (niche === "all" ? seeds : seeds.filter((s) => s.niche === niche)),
    [seeds, niche]
  );

  function handleFollowed(handle: string) {
    setFollowed((prev) => (prev.has(handle) ? prev : new Set(prev).add(handle)));
  }

  if (seeds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No creators to discover yet. Run <code className="font-mono">npm run db:bootstrap</code> to load
        the starter list.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={niche} onValueChange={(v) => setNiche(v as Niche)}>
        <TabsList data-testid="discover-niche-filter">
          {NICHES.map((n) => (
            <TabsTrigger key={n} value={n} className="font-mono uppercase tracking-wide">
              {n}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creators in this niche.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((seed) => (
            <CreatorSeedCard
              key={seed.handle}
              seed={seed.tracked || followed.has(seed.handle) ? { ...seed, tracked: true } : seed}
              onFollowed={handleFollowed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
