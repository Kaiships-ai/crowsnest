"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

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
    <InputGroup className="w-full sm:w-64">
      <InputGroupAddon align="inline-start">
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search the Vault"
        aria-label="Search the Vault"
        className="font-mono text-2xs"
      />
      {value !== "" && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" onClick={() => setValue("")} aria-label="Clear search">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
