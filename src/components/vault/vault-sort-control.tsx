"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
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
    <div className="flex flex-wrap items-center gap-5">
      <span className="font-mono text-2xs tracking-wide text-faint">SORT</span>
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => set(option.value)}
          aria-pressed={sort === option.value}
          className={cn(
            "font-mono text-2xs tracking-wide",
            sort === option.value ? "text-foreground" : "text-faint hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
