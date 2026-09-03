---
status: active
components: [onboarding]
backlog: none
owner: Goal 1 lead (opus) - session_01XbUniwFzh3eahwW2AMyvYH
shipped: null
---

# Settings grouping + first-run adapt (UI Wave 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the improvement board's Wave 4 items for the two System surfaces in Goal 1 scope: the Settings page (`layout` group the 12 sections and the nav to match the sidebar's grouped model; `distill` collapse the Instagram section's buried secondary detail; `clarify` give the jargon section headers a plain one-line "what this controls"; `harden` make the numeric inputs' validation and error states consistent) and the first-run flow (`adapt` collapse the brand aside to a compact header below md so step content is above the fold). Not in scope: `/logs`, `/runs` (Goal 3), the seed-picker (Goal 5 mounts it later).

**Architecture:** Rendering and client-validation layer. No new dependency. Settings grouping is a data-shape change to the nav item list plus group headings on the page and in the nav rail. Numeric validation is a small pure helper plus consistent error display in the shared `NumberField`/`SettingRow`. First-run adapt is responsive Tailwind classes only. One deliberately empty, clearly labelled "Publish" group slot is added to the settings grouping as a placeholder (Goal 4 fills it with S3 bucket, Graph token, dry-run later) - do NOT build its fields.

**Tech Stack:** Next.js (custom `tsx server.ts`), React client components, Tailwind v4, shadcn-style ui primitives, Vitest.

**Spec:** The improvement board (`/tmp/crowsnest-goals/improvement-board.txt`, System section) + `DESIGN.md` (Instrument Panel) + `PRODUCT.md`. Orchestrator scope notes (2026-09-04): drop `/logs`,`/runs`; add an empty Publish group slot; no seed-picker.

## Global Constraints

- **Amber Law:** `--primary` (amber) only on the score and one primary action per screen. On Settings the single amber action is the Scoring save button (it rescores every post); nothing this wave adds may take amber. Nav active state, group labels, validation errors, and the Publish placeholder are all neutral or `--destructive` (errors). Verify per file: `grep -nE "bg-primary|text-primary|border-primary" <file>`.
- **Error tone:** validation and error states use `--destructive` (text-destructive), never amber. Positive/connected stays muted `--pos`.
- **Square corners:** radius tokens are 0; `rounded-*` class names are not bugs, do not touch them.
- **Group labels:** match the sidebar's own group-label style - `font-mono text-2xs tracking-wide text-faint uppercase` (see the sidebar RESEARCH/CREATE/SOURCES/SYSTEM/SETUP labels and settings label typography in DESIGN.md).
- **No fabricated data:** clarify copy describes real behavior only; the Publish slot says it is not configured yet, it must not imply fields exist.
- **Next.js here is not stock:** app opens at `http://localhost:3001` for this wave (Goal 1 port), never 127.0.0.1.
- **Before editing any exported symbol:** run GitNexus `impact` via MCP (`mcp__gitnexus__impact`, repo "crowsnest", direction upstream); report callers/risk; treat UNKNOWN as unresolved; warn on HIGH/CRITICAL. The in-worktree CLI `.gitnexus/run.cjs` is absent; MCP works.

---

### Task 1: Clarify - plain one-line descriptions on the jargon section headers

Board (settings clarify): "Jargon headers (9router, Graph API, Local binaries) need a one-line 'what this controls / when you need it'." Each section already renders an `<h2>` plus a `<p className="text-sm text-muted-foreground">` subheader; this task rewrites those three subheaders (and only those three) to lead with plain language.

**Files:**
- Modify: `src/components/settings/router-section.tsx` (the `<p className="text-sm text-muted-foreground">` under `<h2>9router</h2>`, ~line 117-118)
- Modify: `src/components/settings/graph-section.tsx` (under `<h2>Instagram Graph API</h2>`, ~line 64-65)
- Modify: `src/components/settings/local-binaries-section.tsx` (under `<h2>Local binaries</h2>`, ~line 17-18)

- [ ] **Step 1: Read the three current subheaders** so the rewrite keeps any true detail (e.g. a port number or a real requirement) and only adds the plain "what this controls" lead. Do not drop a fact that is correct.

- [ ] **Step 2: Rewrite the 9router subheader** in `router-section.tsx` to lead with plain language, for example:

```tsx
        <p className="text-sm text-muted-foreground">
          The local proxy that routes generation calls to your Claude API key. You need it running for the Remix
          studio and video analysis to work. Leave it on auto unless you run your own proxy.
        </p>
```
Keep any existing true detail about the port or auto-manage that the current copy carries.

- [ ] **Step 3: Rewrite the Graph API subheader** in `graph-section.tsx`, for example:

```tsx
        <p className="text-sm text-muted-foreground">
          An optional Instagram Graph API token that enriches posts with real view counts. You only need it if you
          want view-based scoring; without it, crowsnest scores on the metrics it can read directly.
        </p>
```
Keep any existing true detail. (Ground the "view counts" claim against the section's real behavior while reading it in Step 1; if it does something narrower, describe that instead - no fabricated capability.)

- [ ] **Step 4: Rewrite the Local binaries subheader** in `local-binaries-section.tsx`, for example:

```tsx
        <p className="text-sm text-muted-foreground">
          The command-line tools crowsnest shells out to: yt-dlp to download a post's video, and whisper for local
          transcription. Install them only if you want video download and transcription to work.
        </p>
```
Ground against the real binaries the section lists (yt-dlp, whisper-cli) while reading it.

- [ ] **Step 5: Verify** - `npm run typecheck && npm run lint && npm run build`. Amber grep on the three files: no new `*-primary`.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/router-section.tsx src/components/settings/graph-section.tsx src/components/settings/local-binaries-section.tsx
git commit -m "clarify(settings): plain-language descriptions on 9router, Graph API, Local binaries"
```

---

### Task 2: Layout - group the 12 settings sections and the nav into labelled groups

Board (settings layout): "12 identical py-8 blocks + a flat 12-item nav - group both to match the main sidebar's own grouped model." Today `settings/page.tsx` holds a flat `SETTINGS_NAV_ITEMS` array of 12 and renders 12 `border-b` blocks; `settings-nav.tsx` renders one flat list. This task introduces groups in both, plus one empty, clearly-labelled "Publish" group placeholder for Goal 4.

**Files:**
- Modify: `src/components/settings/settings-nav.tsx` (the `SettingsNavItem` type, the `SettingsNav` render, and the pure `activeSectionId` stays as-is)
- Modify: `src/app/(shell)/settings/page.tsx` (the `SETTINGS_NAV_ITEMS` const, and the section wrappers get group headings)
- Test: `src/components/settings/settings-nav.test.ts` already exists for `activeSectionId`; keep it green (the observed-id order must still be a flat list derived from the groups).

**Interfaces:**
- Produces: a grouped nav shape:
```ts
export interface SettingsNavItem { id: string; label: string; }
export interface SettingsNavGroup { label: string; items: SettingsNavItem[]; }
```
`SettingsNav` takes `groups: SettingsNavGroup[]`. `activeSectionId` keeps operating on a FLAT `order: string[]` (flatten the groups' item ids in render order) so the IntersectionObserver logic and its test do not change.

**The groups (orchestrator-approved grouping):**
1. **Connections** - Instagram, Graph API
2. **Intelligence** - Niche profile, Scoring, Feed defaults
3. **Generation** - API keys, 9router, Local binaries
4. **Sync** - Sync, Runs and alerts
5. **Publish** - (empty placeholder, Goal 4) - one neutral line "Set up when scheduling and publishing land." No fields, no section body beyond the placeholder.
6. **System** - Onboarding, Appearance

- [ ] **Step 1: GitNexus impact** on `SettingsNav` and `SettingsPage` via MCP (`mcp__gitnexus__impact`, repo "crowsnest", direction upstream, summaryOnly true). Expected: SettingsNav <- settings/page.tsx; SettingsPage <- route. Record risk.

- [ ] **Step 2: Update `settings-nav.tsx`** - add `SettingsNavGroup`, change `SettingsNav` to take `groups: SettingsNavGroup[]`, flatten to `items`/`order` internally so `activeSectionId` and the observer are unchanged, and render each group as a labelled block:

```tsx
export interface SettingsNavItem { id: string; label: string; }
export interface SettingsNavGroup { label: string; items: SettingsNavItem[]; }

export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const items = groups.flatMap((g) => g.items);
  // ...existing activeId seed + IntersectionObserver, unchanged, driven by `items`...
  return (
    <nav aria-label="Settings sections" className="sticky top-6 flex w-44 shrink-0 flex-col gap-4 self-start">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 font-mono text-2xs tracking-wide text-faint uppercase">{group.label}</p>
          {group.items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <a key={item.id} href={`#${item.id}`} aria-current={isActive ? "true" : undefined}
                 className={cn("truncate rounded-sm px-3 py-2 text-sm transition-colors",
                   isActive ? "bg-popover font-semibold text-foreground"
                            : "font-normal text-muted-foreground hover:bg-popover/60 hover:text-foreground")}>
                {item.label}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```
Keep the `activeId` state, the hash seed, and the IntersectionObserver effect exactly as they are, only sourced from `items = groups.flatMap(...)`. Do NOT change `activeSectionId` (keep its test green).

- [ ] **Step 3: Update `settings/page.tsx`** - replace the flat `SETTINGS_NAV_ITEMS` with a grouped `SETTINGS_NAV_GROUPS: SettingsNavGroup[]` in the group order above, pass `groups={SETTINGS_NAV_GROUPS}` to `<SettingsNav>`, and add a group heading above each group's first section on the page so the page's own visual grouping matches the rail. Use the same mono label style. Reorder the section blocks on the page to match the group order (Connections: instagram, graph-api; Intelligence: niche-profile, scoring, feed-defaults; Generation: api-keys, router, local-binaries; Sync: sync, runs-alerts; Publish: placeholder; System: onboarding, appearance). Keep every section's existing props and ids unchanged - only their order and the group headings change.

  Add the Publish placeholder block (neutral, no amber, no fields):
```tsx
        <div id="publish" className="scroll-mt-6 border-b border-border py-8">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Publish</h2>
            <p className="text-sm text-muted-foreground">
              Scheduling and publishing settings appear here once that feature lands. Nothing to configure yet.
            </p>
          </section>
        </div>
```
  And a `{ id: "publish", label: "Publish" }` item as the sole member of the Publish group.

- [ ] **Step 4: Keep the nav test green** - run `npx vitest run src/components/settings/settings-nav.test.ts`. `activeSectionId` is untouched; if the test constructed a flat items array for a prop that changed shape, update only the test's construction of the prop, not the assertions.

- [ ] **Step 5: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build`. Amber grep on both files: no new `*-primary` (group labels are `text-faint`, nav active is `bg-popover`).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settings-nav.tsx "src/app/(shell)/settings/page.tsx"
git commit -m "feat(settings): group the 12 sections and nav into labelled groups, add empty Publish slot"
```

---

### Task 3: Distill - collapse the Instagram section's buried secondary detail

Board (settings distill): "The Instagram section stacks three cards + a full risk paragraph inline - collapse secondary detail so the primary action isn't buried." `instagram-section.tsx` (645 lines, 8 view states in `viewStateOf`) renders the connect/status primary action plus secondary explanatory cards and a risk/warning paragraph inline in the same vertical stack, so the one thing the user acts on competes with a wall of static text.

**Files:**
- Modify: `src/components/settings/instagram-section.tsx`

- [ ] **Step 1: GitNexus impact** on `InstagramSection` via MCP (upstream). Record risk. Read the whole file first: identify (a) the primary action per view state (Connect / Retry / Log out / the sidecar control), (b) the secondary explanatory cards, and (c) the risk/warning paragraph (the throwaway-account guidance). Note `viewStateOf` is pure and unit-tested (`instagram-section.test.ts`) - do NOT change it or its states.

- [ ] **Step 2: Move the secondary detail behind a disclosure** - keep the primary action and the current status line at the top of each state, and collapse the risk paragraph and the secondary explanatory cards into a native `<details>` disclosure (square, neutral) titled e.g. "Why a throwaway account, and what's safe". Use `<details>` + `<summary>` (no new dependency, keyboard-accessible, honors reduced motion for free). The disclosure is closed by default so the primary action sits above the fold. Do not remove any real information - it moves into the disclosure, it does not disappear. Keep every `data-testid` that `instagram-section.test.ts` or the docs reference (grep them first).

- [ ] **Step 3: Keep the primary action visually primary** - it keeps its existing variant (it is not amber today and must not become amber; the Amber Law's one Settings amber is the Scoring save). Ensure the status pill/line and the primary button read first, the disclosure second.

- [ ] **Step 4: Verify** - `npx vitest run src/components/settings/instagram-section.test.ts` (must stay green), then `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Amber grep: no new `*-primary`.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/instagram-section.tsx
git commit -m "distill(settings): collapse Instagram secondary detail behind a disclosure so the action leads"
```

---

### Task 4: Harden - consistent numeric validation and error states

Board (settings harden): "12 forms of numeric inputs (scoring windows, SLA minutes) - verify per-field validation + error states are consistent." Today `NumberField` (`setting-field.tsx`) passes `min`/`max` to a native `<input type=number>` but shows no consistent visible error when a value is empty or out of range; each numeric section coerces `Number(value)` on save with no shared guard. This task adds one shared validation helper and a consistent inline error state, then wires it through the numeric sections' save gating.

**Files:**
- Create: `src/components/settings/number-validation.ts`
- Create: `src/components/settings/number-validation.test.ts`
- Modify: `src/components/settings/setting-field.tsx` (NumberField gets an `error` display)
- Modify: `src/components/settings/scoring-section.tsx`, `src/components/settings/feed-defaults-section.tsx`, `src/components/settings/sync-section.tsx`, `src/components/settings/runs-alerts-section.tsx` (gate save on validity; show the error)

**Interfaces:**
- Produces: `numberFieldError(value: string, opts: { min?: number; max?: number; integer?: boolean }): string | null`.

- [ ] **Step 1: Write the failing test** (`number-validation.test.ts`):

```ts
import { expect, test } from "vitest";
import { numberFieldError } from "./number-validation";

test("empty is an error", () => {
  expect(numberFieldError("", { min: 1 })).toBe("Enter a number");
});
test("below min", () => {
  expect(numberFieldError("0", { min: 1 })).toBe("Must be at least 1");
});
test("above max", () => {
  expect(numberFieldError("50", { max: 30 })).toBe("Must be at most 30");
});
test("non-integer when integer required", () => {
  expect(numberFieldError("1.5", { min: 1, integer: true })).toBe("Must be a whole number");
});
test("valid returns null", () => {
  expect(numberFieldError("12", { min: 1, max: 30, integer: true })).toBeNull();
});
```

- [ ] **Step 2: Run it, watch it fail** - `npx vitest run src/components/settings/number-validation.test.ts`.

- [ ] **Step 3: Write the helper** (`number-validation.ts`, plain module, no "use client"):

```ts
/** Shared validation for the settings NumberField rows (scoring windows, SLA minutes,
 *  feed floors). Returns a plain error message or null. Kept pure so it is unit-testable
 *  without rendering and reusable as the save gate across every numeric section. */
export function numberFieldError(
  value: string,
  opts: { min?: number; max?: number; integer?: boolean }
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter a number";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a number";
  if (opts.integer && !Number.isInteger(n)) return "Must be a whole number";
  if (opts.min !== undefined && n < opts.min) return `Must be at least ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `Must be at most ${opts.max}`;
  return null;
}
```

- [ ] **Step 4: Run it, watch it pass** - `npx vitest run src/components/settings/number-validation.test.ts` (5 pass).

- [ ] **Step 5: Give `NumberField` an error display** - add optional `error?: string | null`; when set, add `aria-invalid` to the input and render the message in `text-destructive` under the field. Keep string-in-local-state (no coercion mid-edit):

```tsx
export function NumberField({ value, onChange, min, max, suffix, disabled, ariaLabel, error }: {
  value: string; onChange: (value: string) => void; min?: number; max?: number;
  suffix?: string; disabled?: boolean; ariaLabel?: string; error?: string | null;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Input type="number" inputMode="numeric" className="w-24" value={value} min={min} max={max}
          disabled={disabled} aria-label={ariaLabel} aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Wire the gate into each numeric section** - in `scoring-section.tsx`, `feed-defaults-section.tsx`, `sync-section.tsx`, `runs-alerts-section.tsx`: for each numeric field compute `numberFieldError(value, { min, max, integer: true })` using the same min/max already passed to `NumberField`, pass it as `error`, and block the section's save (disable the save button / skip the confirm) when any field in that section has a non-null error. Read each section to find its existing min/max and save handler; keep the existing dirty logic, only add the validity gate. Do not invent new bounds - reuse the bounds each field already declares.

- [ ] **Step 7: Verify** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Amber grep on all touched files: errors are `text-destructive`, no `*-primary`.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/number-validation.ts src/components/settings/number-validation.test.ts src/components/settings/setting-field.tsx src/components/settings/scoring-section.tsx src/components/settings/feed-defaults-section.tsx src/components/settings/sync-section.tsx src/components/settings/runs-alerts-section.tsx
git commit -m "harden(settings): shared numeric validation with consistent inline error states"
```

---

### Task 5: Adapt - first-run brand aside collapses to a compact header below md

Board (first-run adapt): "below md the brand aside stacks on top, and the absolute progress spine + 11rem numeral were tuned for the fixed rail - collapse the aside to a compact header on narrow so step content is above the fold." `onboarding-flow.tsx` uses `grid grid-cols-1 md:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]`; below md the full-height aside (11rem ghost numeral, tagline block, mt-auto progress spine on a `min-h-screen`) stacks above the step content and pushes it off the fold.

**Files:**
- Modify: `src/components/first-run/onboarding-flow.tsx` (the `<aside>` and its children's responsive classes; the grid is fine)

- [ ] **Step 1: GitNexus impact** on `OnboardingFlow` via MCP (upstream). Expected caller: `first-run/page.tsx`. Record risk.

- [ ] **Step 2: Make the aside compact below md** - on narrow the aside becomes a short header (a row with the "Crowsnest" wordmark and a compact step indicator), with the 11rem ghost numeral, the tagline paragraph, and the full vertical progress spine hidden; at `md` and up everything is exactly as today:
  - Aside container: relax the forced full-height feel on narrow - e.g. `py-4 md:py-12` and let the grid's narrow row be content-height.
  - The 11rem ghost numeral `<span>`: add `hidden md:block`.
  - The tagline block ("Watch the channels you compete with." heading + paragraph): `hidden md:block`.
  - The progress block: wrap the existing vertical spine/`<nav>` in `hidden md:flex` and add a narrow-only compact line (`md:hidden`) showing the current step label and `n / N`. Keep `md`+ layout identical.
  - Keep the wordmark "Crowsnest" visible in both.
  - Preserve `motion-reduce` and the neutral, never-amber discipline; the ghost numeral stays `text-foreground/[0.04]`.

- [ ] **Step 3: Verify statically + by browse** - `npm run typecheck && npm run lint && npm run build`. Framework/route file, no vitest by convention; verify responsiveness in Round 1's browse walk at a narrow viewport (first-run needs `first_run_completed=false`; the Round 1 walk sets it on the copied DB). Amber grep: no new `*-primary`.

- [ ] **Step 4: Commit**

```bash
git add src/components/first-run/onboarding-flow.tsx
git commit -m "adapt(first-run): compact brand header below md so step content stays above the fold"
```

---

### Task 6: Docs

Settings has no five-doc component block (component dirs are analyze/feed/ig-sync/kit/llm/mine/onboarding/remix/studio), so per the DoD ("settings if it has a block") there is no settings doc to update. First-run is documented under the `onboarding` component.

**Files:**
- Modify: `documents/architect/core-components/onboarding/02-architecture.md` (note the first-run aside collapses to a compact header below md; grounded to `onboarding-flow.tsx`, evergreen, no em/en dashes, straight quotes, sentence-case headings)

- [ ] **Step 1: Read onboarding/02-architecture.md**, match its structure, add one short paragraph on the responsive aside behavior.
- [ ] **Step 2: Run the full gate** - `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. All pass; tree clean after commit.
- [ ] **Step 3: Commit**

```bash
git add documents/
git commit -m "docs(onboarding): document the responsive first-run aside"
```

---

## Self-Review

**Spec coverage:** settings clarify -> T1; settings layout (group + nav + Publish slot) -> T2; settings distill (Instagram) -> T3; settings harden (numeric validation) -> T4; first-run adapt -> T5; docs -> T6. Out of scope (orchestrator): /logs, /runs (Goal 3); seed-picker (Goal 5). Publish fields NOT built - empty labelled slot only.

**Placeholder scan:** T1/T3/T4/T5 require the implementer to read current code (jargon copy detail, the 645-line Instagram states, each numeric section's bounds and save handler, the aside children); each step names what to read and the exact shape to produce. T2 and T4's helper carry full code. No TBD.

**Type consistency:** `SettingsNavGroup { label, items }` / `SettingsNav({ groups })` match between settings-nav.tsx and page.tsx. `numberFieldError(value, { min, max, integer })` matches its test and four call sites. `NumberField`'s new `error?` is optional and back-compatible with every call site.

**Amber Law self-check:** No task adds `*-primary`. Group labels `text-faint`, nav active `bg-popover`, validation errors `text-destructive`, Publish placeholder neutral, first-run ghost numeral unchanged. Each task ends with a grep check.

**Shared-file order:** T2 (settings/page.tsx + settings-nav.tsx) reorders the page; T4 edits the numeric sections' bodies (scoring/feed/sync/runs-alerts) and setting-field.tsx. No same-line overlap, but run in task order so the section reorder settles before T4 gates their saves. T1 (router/graph/local-binaries) and T3 (instagram) touch section files not in T4. Sequential SDD handles it.
