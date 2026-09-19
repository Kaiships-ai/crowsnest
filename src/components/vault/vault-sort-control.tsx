"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SavedPostSort } from "@/server/queries/saved-posts";

// Three real orderings (queries/saved-posts.ts's SavedPostSort). "Why kept" is free
// text, not orderable, so it never gets a fourth option here.
const SORT_OPTIONS: { value: SavedPostSort; label: string }[] = [
  { value: "recent", label: "Recently saved" },
  { value: "score", label: "Highest score" },
  { value: "analyzed", label: "Analysed first" },
];

/** Lives in the URL (matches FilterBar's convention in feed/filter-bar.tsx) so the
 * ordering survives a reload, per Vault AC 6. */
export function VaultSortControl({ sort }: { sort: SavedPostSort }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(value: SavedPostSort) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "recent") params.delete("sort");
    else params.set("sort", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span data-lab className="font-mono text-2xs text-muted-foreground">
        Sort
      </span>
      {/* This build's ToggleGroup is multi-select by shape: `value` is an array and
          `onValueChange` hands back an array. One element in, first element out keeps it
          an exclusive choice. */}
      <ToggleGroup
        value={[sort]}
        onValueChange={(vals: unknown[]) => {
          const next = vals[0] as SavedPostSort | undefined;
          if (next) set(next);
        }}
        aria-label="Sort the Vault"
      >
        {SORT_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} size="sm">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
