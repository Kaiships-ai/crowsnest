"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime-local";
import { cn } from "@/lib/utils";
import type { LogEventRow, LogQueryFilter, LogSource, StoredLogLevel } from "@/server/logs/store";

const LEVELS: StoredLogLevel[] = ["info", "warn", "error"];
// The store's own default (queryLogEvents) when no levels are given — problems-only.
// Kept here so "Show everything" has something to turn back off into.
const PROBLEMS_ONLY: StoredLogLevel[] = ["warn", "error"];

const SOURCE_ITEMS: { value: LogSource | "all"; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "backend", label: "backend" },
  { value: "frontend", label: "frontend" },
  { value: "sidecar", label: "local service" },
];

// Same read-as-state trigger treatment the feed's filter row uses (filter-bar.tsx) —
// plain text with a chevron, not boxed input chrome, so this row matches every other
// list screen instead of inventing its own control style.
const FILTER_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-none border-transparent bg-transparent px-2 text-sm text-muted-foreground hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-card";

// Amber is reserved for the outlier score elsewhere in this app (channel-table.tsx),
// so a log's level leans on text weight and the destructive color alone rather than
// borrowing it.
const LEVEL_LABEL_CLASS: Record<StoredLogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-foreground",
  error: "text-destructive",
};

function sameLevelSet(a: StoredLogLevel[], b: StoredLogLevel[]) {
  return a.length === b.length && b.every((level) => a.includes(level));
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function LogsView({ rows, filter }: { rows: LogEventRow[]; filter: LogQueryFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<number | null>(null);

  // Levels and source navigate the instant they're picked (same convention as the
  // feed's discrete filters, filter-bar.tsx) — only free text below waits for Refresh.
  const urlLevels = searchParams.get("levels");
  const levels = urlLevels !== null
    ? (urlLevels.split(",").filter(Boolean) as StoredLogLevel[])
    : (filter.levels ?? LEVELS);
  const source = (searchParams.get("source") as LogSource | null) ?? filter.source ?? "all";
  const showEverything = sameLevelSet(levels, LEVELS);

  // Draft-only fields: applied to the URL on Refresh (or Enter), not per keystroke —
  // free text shouldn't thrash the URL mid-word, the same reasoning the feed's search
  // box follows (filter-bar.tsx SEARCH_DEBOUNCE_MS comment).
  const [eventDraft, setEventDraft] = useState(searchParams.get("event") ?? filter.event ?? "");
  const [sinceDraft, setSinceDraft] = useState(isoToLocalInput(searchParams.get("since") ?? filter.since ?? ""));
  const [untilDraft, setUntilDraft] = useState(isoToLocalInput(searchParams.get("until") ?? filter.until ?? ""));
  const [searchDraft, setSearchDraft] = useState(searchParams.get("search") ?? filter.search ?? "");

  function navigate(params: URLSearchParams) {
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setLevels(next: StoredLogLevel[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (sameLevelSet(next, LEVELS)) {
      // Back to the implicit default — keep the URL as short as a bare /logs visit.
      params.delete("levels");
    } else {
      params.set("levels", next.join(","));
    }
    navigate(params);
  }

  function toggleLevel(level: StoredLogLevel, checked: boolean) {
    setLevels(checked ? [...levels, level] : levels.filter((l) => l !== level));
  }

  function setSource(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("source");
    else params.set("source", value);
    navigate(params);
  }

  function setOrDelete(params: URLSearchParams, key: string, value: string) {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
    else params.delete(key);
  }

  function applyDraftFilters() {
    const params = new URLSearchParams(searchParams.toString());
    setOrDelete(params, "event", eventDraft);
    setOrDelete(params, "since", localInputToIso(sinceDraft));
    setOrDelete(params, "until", localInputToIso(untilDraft));
    setOrDelete(params, "search", searchDraft);
    navigate(params);
    // The URL can end up unchanged (e.g. clicking Refresh with no draft edits) — this
    // still forces the server component to re-run queryLogEvents, so Refresh always
    // means "read the latest rows", not just "reapply what's already showing".
    router.refresh();
  }

  function onDraftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") applyDraftFilters();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="relative max-w-md">
          <Input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder="Search event and fields"
            aria-label="Search event and fields"
            className="h-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            {LEVELS.map((level) => (
              <label key={level} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={levels.includes(level)}
                  onCheckedChange={(checked) => toggleLevel(level, checked === true)}
                  aria-label={`Show ${level} level`}
                />
                <span className={LEVEL_LABEL_CLASS[level]}>{level}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Switch
              checked={showEverything}
              onCheckedChange={(checked) => setLevels(checked ? LEVELS : PROBLEMS_ONLY)}
              aria-label="Show everything"
              size="sm"
            />
            <span className="text-sm text-muted-foreground">Show everything</span>
          </div>

          <Select
            items={SOURCE_ITEMS}
            value={source}
            onValueChange={(v) => setSource(v as string)}
          >
            <SelectTrigger size="sm" aria-label="Source" className={FILTER_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_ITEMS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={eventDraft}
            onChange={(e) => setEventDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder="Event prefix"
            aria-label="Event"
            className="h-7 w-40"
          />

          <div className="flex items-center gap-1.5">
            <Label htmlFor="logs-since" className="text-2xs text-muted-foreground">
              Since
            </Label>
            <Input
              id="logs-since"
              type="datetime-local"
              value={sinceDraft}
              onChange={(e) => setSinceDraft(e.target.value)}
              onKeyDown={onDraftKeyDown}
              aria-label="Since"
              className="h-7 w-52"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Label htmlFor="logs-until" className="text-2xs text-muted-foreground">
              Until
            </Label>
            <Input
              id="logs-until"
              type="datetime-local"
              value={untilDraft}
              onChange={(e) => setUntilDraft(e.target.value)}
              onKeyDown={onDraftKeyDown}
              aria-label="Until"
              className="h-7 w-52"
            />
          </div>

          <Button variant="outline" size="sm" onClick={applyDraftFilters} className="ml-auto">
            <RefreshCw /> Refresh
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No log events match this filter.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="h-auto pb-3 text-2xs font-normal text-muted-foreground">Time</TableHead>
                <TableHead className="h-auto pb-3 text-2xs font-normal text-muted-foreground">Level</TableHead>
                <TableHead className="h-auto pb-3 text-2xs font-normal text-muted-foreground">Source</TableHead>
                <TableHead className="h-auto pb-3 text-2xs font-normal text-muted-foreground">Event</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const open = openId === r.id;
                return (
                  <TableRow
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} fields for ${r.event}`}
                    onClick={() => setOpenId(open ? null : r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(open ? null : r.id);
                      }
                    }}
                    className="cursor-pointer border-border align-top"
                  >
                    <TableCell className="whitespace-nowrap py-2 font-mono text-2xs text-muted-foreground">
                      {formatTs(r.ts)}
                    </TableCell>
                    <TableCell className={cn("py-2 text-sm font-medium", LEVEL_LABEL_CLASS[r.level])}>
                      {r.level}
                    </TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">{r.source}</TableCell>
                    <TableCell className="py-2 text-sm">
                      {r.event}
                      {open && (
                        <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-card p-2 text-2xs text-muted-foreground">
                          {JSON.stringify(r.fields, null, 2)}
                        </pre>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
