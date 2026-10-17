"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoToLocalInput, localInputToIso } from "@/lib/datetime-local";
import { cn } from "@/lib/utils";
import { DEFAULT_LOG_LEVELS, LOG_LEVELS } from "./levels";
import type { LogEventRow, LogQueryFilter, LogSource, StoredLogLevel } from "@/server/logs/store";


const SOURCE_ITEMS: { value: LogSource | "all"; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "backend", label: "backend" },
  { value: "frontend", label: "frontend" },
  { value: "sidecar", label: "local service" },
];

// A log's level is read as text, not as a filled chip: three of these sit in every row
// of a long table, and three badges per row would out-shout the event names the reader
// is actually scanning. Only `error` gets a hue.
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
    : (filter.levels ?? LOG_LEVELS);
  const source = (searchParams.get("source") as LogSource | null) ?? filter.source ?? "all";
  const showEverything = sameLevelSet(levels, LOG_LEVELS);

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
    if (sameLevelSet(next, DEFAULT_LOG_LEVELS)) {
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
      <div className="flex flex-col gap-3">
        <Input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder="Search event and fields"
          aria-label="Search event and fields"
          className="max-w-md"
        />

        <div className="flex flex-wrap items-center gap-2">
          {LOG_LEVELS.map((level) => (
            <Field key={level} orientation="horizontal" className="w-auto">
              <Checkbox
                id={`logs-level-${level}`}
                checked={levels.includes(level)}
                onCheckedChange={(checked) => toggleLevel(level, checked === true)}
              />
              <FieldLabel htmlFor={`logs-level-${level}`} className={LEVEL_LABEL_CLASS[level]}>
                {level}
              </FieldLabel>
            </Field>
          ))}

          <Field orientation="horizontal" className="w-auto">
            <Switch
              id="logs-show-everything"
              checked={showEverything}
              onCheckedChange={(checked) => setLevels(checked ? LOG_LEVELS : DEFAULT_LOG_LEVELS)}
              size="sm"
            />
            <FieldLabel htmlFor="logs-show-everything" className="text-muted-foreground">
              Show everything
            </FieldLabel>
          </Field>

          {/* Source and event prefix narrow the same list, so they read as one control
              rather than two loose ones. */}
          <ButtonGroup>
            <Select items={SOURCE_ITEMS} value={source} onValueChange={(v) => setSource(v as string)}>
              <SelectTrigger size="sm" aria-label="Source">
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
              className="w-40"
            />
          </ButtonGroup>

          <Field orientation="horizontal" className="w-auto">
            <FieldLabel htmlFor="logs-since" className="text-muted-foreground">
              Since
            </FieldLabel>
            <Input
              id="logs-since"
              type="datetime-local"
              value={sinceDraft}
              onChange={(e) => setSinceDraft(e.target.value)}
              onKeyDown={onDraftKeyDown}
              className="w-52"
            />
          </Field>

          <Field orientation="horizontal" className="w-auto">
            <FieldLabel htmlFor="logs-until" className="text-muted-foreground">
              Until
            </FieldLabel>
            <Input
              id="logs-until"
              type="datetime-local"
              value={untilDraft}
              onChange={(e) => setUntilDraft(e.target.value)}
              onKeyDown={onDraftKeyDown}
              className="w-52"
            />
          </Field>

          <Button variant="outline" size="sm" onClick={applyDraftFilters} className="ml-auto">
            <RefreshCw /> Refresh
          </Button>
        </div>
      </div>

      <Separator />

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No log events match this filter.</EmptyTitle>
            <EmptyDescription>Widen the levels, clear the event prefix, or move the since and until bounds.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Event</TableHead>
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
                  className="cursor-pointer align-top"
                >
                  <TableCell className="font-mono text-muted-foreground">{formatTs(r.ts)}</TableCell>
                  <TableCell className={cn("font-medium", LEVEL_LABEL_CLASS[r.level])}>{r.level}</TableCell>
                  <TableCell className="text-muted-foreground">{r.source}</TableCell>
                  <TableCell>
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
      )}
    </div>
  );
}
