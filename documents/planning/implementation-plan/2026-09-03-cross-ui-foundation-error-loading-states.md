---
status: shipped
components: [shared]
backlog: none
owner: session_01PB62kSQfaU3UsFWiu7Jw83
shipped: "2026-09-03 851249d"
---

# UI Foundation: Error Boundaries, Loading Skeletons, Table Overflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended), or execute the plan directly in this session — phase by phase, verifying each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every crowsnest page a graceful error boundary, a loading state instead of a blank paint, and stop wide tables from scrolling the page body sideways — the three cross-cutting gaps the Impeccable Evaluate pass found across all 14 routes.

**Architecture:** Next.js App Router error/loading conventions. One shared `ErrorState` client component consumed by three `error.tsx` boundaries (shell pages, root/first-run, and a self-contained `global-error.tsx` for root-layout failures). One generic `(shell)/loading.tsx` skeleton covers every shell page that lacks its own (feed keeps its bespoke one). Wide tables get an `overflow-x-auto` wrapper.

**Tech Stack:** Next.js 15 App Router (custom `tsx server.ts`), React 19, Tailwind v4 with the crowsnest token theme, the existing `@/components/ui/skeleton` primitive, `lucide-react` icons.

**Spec:** Improvement board (this session's Impeccable Evaluate pass) — cross-cutting section. No separate spec file; the board's cross-cutting items 1–3 are the requirements.

## Global Constraints

- **Instrument Panel system (DESIGN.md), non-negotiable:** square corners (every surface `border-radius: 0`; the only pill is the button). Amber (`--primary`) is reserved for the score and one primary action per screen — **never** on an error banner, a skeleton, a spinner, or a retry button. Errors use `--destructive`; retry is a neutral/outline button. Numbers stay `font-mono` tabular.
- **No fabricated data:** skeletons are neutral placeholder blocks, never invented numbers.
- **Copy voice:** plain and honest. An error names what failed and offers the recovery action ("Try again"), no apologies, no vague "Something went wrong" without a next step.
- **`rounded-*` classes are fine:** the tokens set `--radius-*: 0`, so `rounded-none`/`rounded-md` both render square. Prefer `rounded-none` in new code for clarity, but existing `rounded-*` is not a bug to chase.
- **Verification reality:** `error.tsx`, `loading.tsx`, and `global-error.tsx` are Next.js framework files with no pure logic to unit-test, and the repo ships its existing `loading.tsx` with no unit test. So each such task verifies by `npm run build` (Next validates the file's shape and export), `npm run typecheck`, and the full suite staying green — plus a `browse` e2e where a state is visually reachable. This replaces the generic TDD loop for these files; do not invent a vitest test that only asserts JSX exists.
- **Before committing:** `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all pass and the tree is clean (AGENTS.md).

---

### Task 1: Shared `ErrorState` component

The one error UI all boundaries render, so the three `error.tsx` files stay DRY and identical in look. A client component (error boundaries must be client components).

**Files:**
- Create: `src/components/layout/error-state.tsx`

**Interfaces:**
- Produces: `export function ErrorState({ title, detail, reset }: { title?: string; detail?: string; reset?: () => void }): JSX.Element` — later tasks (the three boundaries) render this, passing the boundary's `reset` and an optional custom title.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The single error surface every route boundary renders (src/app/(shell)/error.tsx,
 * src/app/error.tsx, and — inlined, since it needs its own <html> — global-error.tsx).
 * Square, destructive-toned, one neutral retry. Amber is never used here: the Amber Law
 * (DESIGN.md) reserves it for the score and one primary action, and an error is neither.
 */
export function ErrorState({
  title = "This page hit an error.",
  detail,
  reset,
}: {
  title?: string;
  detail?: string;
  reset?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-8 py-16">
      <div className="w-full max-w-[440px] border border-destructive/40 bg-card p-6">
        <span className="font-mono text-2xs tracking-wide text-destructive">ERROR</span>
        <h1 className="mt-3 text-lg leading-tight font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {detail ?? "The rest of the app is unaffected. Try again, and if it keeps happening, check Logs."}
        </p>
        {reset && (
          <Button variant="outline" className="mt-6" onClick={reset}>
            <RotateCw className="size-4" /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/error-state.tsx
git commit -m "feat(ui): add shared ErrorState surface for route error boundaries"
```

---

### Task 2: `(shell)/error.tsx` — catches every shell page throw

Covers the bulk of the app: dashboard, feed, vault, ideas, settings, channels, mine, persona, logs, runs. A segment `error.tsx` catches throws from that segment's pages and nested children (not its own layout — Task 3 handles that).

**Files:**
- Create: `src/app/(shell)/error.tsx`

**Interfaces:**
- Consumes: `ErrorState` from Task 1.

- [ ] **Step 1: Create the boundary**

```tsx
"use client";

// Next.js App Router error boundary for every page under (shell). Catches a throw from
// any shell PAGE (a failed server query in dashboard/feed/vault/ideas/settings/…) and
// renders one recoverable surface instead of a blank screen. A throw in (shell)/layout.tsx
// itself bubbles past this to src/app/error.tsx (Task 3).
import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The client-error reporter already lives in the shell; log to console so a dev sees
    // the real stack. Do not surface the raw message to the user.
    console.error("shell route error:", error);
  }, [error]);

  return <ErrorState reset={reset} />;
}
```

- [ ] **Step 2: Build (Next validates the boundary shape)**

Run: `npm run build`
Expected: `✓ Compiled successfully`; no error about `error.tsx` missing `"use client"` or the wrong export.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(shell)/error.tsx"
git commit -m "feat(ui): add error boundary for shell page throws"
```

---

### Task 3: `src/app/error.tsx` — catches shell-layout and first-run throws

`(shell)/layout.tsx` is `force-dynamic` and awaits several queries (`getFailureStrip`, `getDashboardStats`, …); a throw there bubbles **past** the shell boundary to the root app segment. `/first-run` also awaits `getIgStatusAction`. This boundary catches both.

**Files:**
- Create: `src/app/error.tsx`

**Interfaces:**
- Consumes: `ErrorState` from Task 1.

- [ ] **Step 1: Create the boundary**

```tsx
"use client";

// Root-segment error boundary. Catches what the shell boundary can't: a throw inside
// (shell)/layout.tsx (which awaits queries under force-dynamic), and a throw in the
// /first-run page. Renders the same recoverable surface.
import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("root route error:", error);
  }, [error]);

  return <ErrorState reset={reset} />;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add src/app/error.tsx
git commit -m "feat(ui): add root error boundary for shell-layout and first-run throws"
```

---

### Task 4: `src/app/global-error.tsx` — root-layout catch-all

The last net: a throw in `src/app/layout.tsx` itself bubbles past `error.tsx`. `global-error` replaces the entire document, so it must render its own `<html>`/`<body>` and cannot use the app's providers. Keep it self-contained and minimal (no `ErrorState`, which assumes app CSS/tokens are mounted).

**Files:**
- Create: `src/app/global-error.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

// Replaces the whole document when even the root layout throws. It renders outside the
// app's providers and token CSS, so it is intentionally self-contained with inline styles
// — no shared components, no Tailwind assumptions. Destructive red, one neutral retry,
// never amber.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0b0c",
          color: "#f2f2f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 440, padding: 24, border: "1px solid rgba(217,80,63,0.4)" }}>
          <span style={{ fontFamily: "monospace", fontSize: 13, letterSpacing: "0.06em", color: "#d9503f" }}>ERROR</span>
          <h1 style={{ margin: "12px 0 0", fontSize: 20, fontWeight: 600 }}>Crowsnest failed to start this page.</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, color: "#9a9a96" }}>
            Reload to try again. If it persists, restart the app from the terminal.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "9px 17px",
              background: "transparent",
              color: "#f2f2f0",
              border: "1px solid #3e3e46",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add src/app/global-error.tsx
git commit -m "feat(ui): add global-error root-layout catch-all"
```

---

### Task 5: `(shell)/loading.tsx` — one skeleton for every blank-paint page

A segment `loading.tsx` shows for its own page **and** every descendant segment without its own. Placing it at `(shell)` covers dashboard, settings, channels, mine, persona, logs, runs, vault, ideas in one file; `feed/(list)/loading.tsx` already exists and overrides it there. Generic-but-shaped: a titled column with a panel block and a tile row, matching the shell's common composition, so any load reads as structure, not a spinner.

**Files:**
- Create: `src/app/(shell)/loading.tsx`

**Interfaces:**
- Consumes: `Skeleton` from `@/components/ui/skeleton` (existing primitive; see `(shell)/feed/(list)/loading.tsx` for the house pattern).

- [ ] **Step 1: Create the skeleton**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Default loading state for every shell page that has no bespoke one (feed keeps its own).
// Square blocks on the card token, never a spinner and never amber — the layout itself
// communicates while the page's server queries resolve. DESIGN.md §6.
export default function ShellLoading() {
  return (
    <div className="flex h-full flex-col gap-10 px-8 py-8">
      <Skeleton className="h-9 w-56 rounded-none" />

      {/* a panel block */}
      <Skeleton className="h-40 w-full max-w-4xl rounded-none" />

      {/* a stat / tile row */}
      <div className="grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 border border-border bg-card p-5">
            <Skeleton className="h-4 w-24 rounded-none" />
            <Skeleton className="h-7 w-12 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Verify it renders (browse e2e, best-effort)**

The dev server + ig sidecar are running. A loading skeleton is transient, so confirm the file is picked up by checking the route still renders its real content after load (the skeleton must not replace the page permanently):

Run (via the browse skill): `goto http://localhost:3000/settings`, `wait --networkidle`, then confirm `text` contains a real settings string (e.g. "Niche profile"). If the page shows real content, the loading file is wired correctly and did not break the route.
Expected: settings content present; no console error about `loading.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(shell)/loading.tsx"
git commit -m "feat(ui): add default shell loading skeleton for blank-paint pages"
```

---

### Task 6: Wrap wide tables in `overflow-x-auto`

Logs and Runs render multi-column `<Table>`s with no horizontal-scroll container, so a narrow window scrolls the whole page body sideways — which the design system forbids (wide content scrolls in its own container). Wrap each `<Table>` in a `div` with `overflow-x-auto`.

**Files:**
- Modify: `src/components/logs/logs-view.tsx` (the `<Table>` around line 230)
- Modify: `src/components/runs/run-detail.tsx` (the trace `<Table>` around line 294)
- Modify: `src/components/runs/runs-list.tsx` (the runs list `<Table>` — grep for `<Table` in this file)

**Interfaces:** none (pure JSX wrapping; no signature change).

- [ ] **Step 1: Wrap the logs table**

In `src/components/logs/logs-view.tsx`, wrap the results `<Table>…</Table>` block in a scroll container. Change:

```tsx
        <Table>
```
…so the `<Table>` (and its closing `</Table>`) sit inside:

```tsx
        <div className="w-full overflow-x-auto">
          <Table>
            {/* …unchanged… */}
          </Table>
        </div>
```

Do not change any table content — only add the wrapping `div`.

- [ ] **Step 2: Wrap both runs tables**

Apply the identical `<div className="w-full overflow-x-auto"> … </div>` wrapper around the `<Table>` in `src/components/runs/run-detail.tsx` (~line 294) and around the `<Table>` in `src/components/runs/runs-list.tsx` (grep `<Table` to find it). Content unchanged.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 4: Verify no page-body horizontal scroll (browse e2e)**

Via the browse skill, at a narrow viewport, confirm the body does not scroll sideways while the table does:

```
viewport 640x900
goto http://localhost:3000/logs   (wait --networkidle)
js "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
```
Expected: `true` (no page-body horizontal overflow). Repeat for `http://localhost:3000/runs`.
If `false`, the wrapper is missing on a table that page renders — re-check the wrap.

- [ ] **Step 5: Commit**

```bash
git add src/components/logs/logs-view.tsx src/components/runs/run-detail.tsx src/components/runs/runs-list.tsx
git commit -m "fix(ui): scroll wide log and run tables in their own container, not the page body"
```

---

### Task 7: Full-suite gate + branch finish

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run:
```bash
npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh
```
Expected: typecheck clean, lint clean (pre-existing `.gitnexus/run.cjs` require-import errors are gitignored and out of scope — confirm no NEW errors in `src/`), all vitest tests pass, build compiles, testid audit `OK`.

- [ ] **Step 2: Confirm the working tree is clean and hand off**

Run: `git status --short`
Expected: empty. Then this plan's work is done; hand back for review / PR.

---

## Self-Review

**Spec coverage (board cross-cutting 1–3):**
- Error boundaries app-wide → Tasks 1–4 (shared surface + shell pages + root/first-run + global catch-all). ✓
- Loading skeletons for blank-paint pages → Task 5 (one `(shell)/loading.tsx` covering all shell pages without their own; feed keeps its bespoke one). ✓ Note: per-page *shaped* skeletons for dashboard/vault/ideas/video-detail are deliberately deferred to their domain waves (the video-detail one needs an in-page `<Suspense>` after the `notFound()` check to avoid re-introducing the B-14 404 regression — out of scope here).
- Table overflow → Task 6 (logs + both runs tables). ✓

**Placeholder scan:** every file's full contents are given; no TBD/TODO. The one grep instruction (runs-list `<Table>`) is a locate-then-wrap with the exact wrapper shown. ✓

**Type consistency:** `ErrorState({ title?, detail?, reset? })` defined in Task 1 is consumed unchanged in Tasks 2–3; Task 4 deliberately does not use it (documented why). ✓

**Deviation from the plan template:** framework files (`error.tsx`/`loading.tsx`/`global-error.tsx`) carry no vitest unit test — they have no pure logic and the repo ships such files untested. Verification is build + typecheck + full-suite-green + a browse e2e where a state is reachable (Tasks 5, 6). This is stated in Global Constraints and is intentional, not a gap.
