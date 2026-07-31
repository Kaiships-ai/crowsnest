"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The prototype's sidebar checklist tracked four session flags — `seenDetail`,
 * `didAnalyse`, `didSave`, `didRemix` — that reset on sign-out and have no
 * persisted equivalent in this schema (v1-gap-inventory.md: "Would need four
 * `app_settings` keys or one JSON key"). v1-scope.md P1 scopes a checklist with
 * "its four real flags" plus a Settings row to hide/show it — both are new
 * `app_settings` write paths, out of scope for a rendering-layer pass.
 *
 * This checklist tracks four DIFFERENT facts instead, chosen because each one
 * already exists with no new backend work: `first_run_completed` (a real
 * settings key), whether any channel is tracked, whether any post has been
 * saved, and whether any script has been drafted (all real row counts). It is
 * a genuine substitute, not a placeholder for the P1 version — read that
 * P1 line as "still open" until someone adds the visit-tracking flags it asks
 * for.
 */
export interface GetStartedItem {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

const HIDE_KEY = "crowsnest.getStartedHidden";

// Same-tab-only pub/sub: `localStorage` doesn't fire its own `storage` event for writes
// made from the tab that wrote them (only other tabs get that), so a plain read-on-mount
// wouldn't notice the hide button's own write. `useSyncExternalStore` below re-reads this
// snapshot whenever `notify()` runs — that's the entire subscription, there is nothing
// external to actually watch beyond "did this component just change it".
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return window.localStorage.getItem(HIDE_KEY) === "1";
}
// The server has no localStorage and no visitor identity, so it can't know whether this
// browser hid the list before — false (visible) is the only honest default, and
// `useSyncExternalStore` reconciles it against the real client value after hydration
// without the cascading-setState-in-an-effect pattern eslint's `set-state-in-effect`
// flags a plain `useEffect` read as.
function getServerSnapshot() {
  return false;
}

export function GetStartedChecklist({ items }: { items: GetStartedItem[] }) {
  // Whether the list was dismissed lives in localStorage, not `app_settings` —
  // Settings has no "checklist visibility" row yet (that's the same P1 item
  // named above), so a real per-browser dismiss is the closest honest stand-in
  // rather than a control that looks wired to Settings but isn't.
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const doneCount = items.filter((item) => item.done).length;
  const allDone = doneCount === items.length;

  // Nothing once hidden, and nothing once every item is done — same as the
  // prototype, whose `showChecklist` is `!checklistHidden && !(all four true)`.
  if (hidden || allDone) return null;

  function hide() {
    window.localStorage.setItem(HIDE_KEY, "1");
    notify();
  }

  return (
    <div className="pb-5">
      <div className="flex items-baseline justify-between gap-3 px-6">
        <span className="font-mono text-2xs tracking-wide text-faint">
          GET STARTED <span className="tabular-nums">{doneCount}/{items.length}</span>
        </span>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide the getting-started checklist"
          className="-mr-1 font-mono text-2xs text-faint transition-colors hover:text-foreground"
        >
          hide
        </button>
      </div>
      <div className="mt-2.5 flex flex-col">
        {items.map((item) =>
          item.done ? (
            <div
              key={item.key}
              className="mx-3 flex items-center gap-2.5 px-3 py-1.5 text-sm text-muted-foreground"
            >
              {/* Positive, not amber — amber is reserved for the score and one
                  primary action per screen; a completed checklist row is neither. */}
              <span aria-hidden className="size-[9px] shrink-0 rounded-full bg-[var(--pos)]" />
              <span className="min-w-0 flex-1 truncate line-through decoration-muted-foreground/40">
                {item.label}
              </span>
            </div>
          ) : (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "mx-3 flex items-center gap-2.5 px-3 py-1.5 text-sm text-foreground/90 transition-colors",
                "hover:bg-popover/60 hover:text-foreground"
              )}
            >
              <span aria-hidden className="size-[9px] shrink-0 rounded-full ring-1 ring-inset ring-border" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          )
        )}
      </div>
    </div>
  );
}
