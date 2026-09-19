"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";

/** Search across every Vault tab at once. Lives in the URL like VaultSortControl's
 * sort, so a search survives a reload and can be linked to.
 *
 * Typing writes the URL on a short debounce rather than per keystroke: each write
 * re-runs the page's four queries on the server, and a keystroke-per-query round trip
 * made the field feel like it was fighting back. */
export function VaultSearch({ query }: { query: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(query);
  // The URL this component last wrote. Compared against `query` below so the field
  // follows a Back/Forward navigation, without also stamping over what the user is
  // mid-way through typing.
  const written = useRef(query);

  useEffect(() => {
    if (query !== written.current) {
      written.current = query;
      setValue(query);
    }
  }, [query]);

  useEffect(() => {
    if (value === written.current) return;
    const timer = setTimeout(() => {
      written.current = value;
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim() === "") params.delete("q");
      else params.set("q", value);
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [value, pathname, router, searchParams]);

  return (
    <div className="relative w-full max-w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search the Vault"
        aria-label="Search the Vault"
        className="h-8 pl-8 pr-8 font-mono text-2xs"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
