# M3a part 2 feed toolbar grouping implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feed toolbar's two toggle groups (layout and density) read as two groups, not one run of four icons where two look selected.

**Architecture:** One task, a visual grouping change in filter-bar.tsx. The layout toggle (grid/list) and the density toggle (comfortable/compact) are adjacent ToggleGroups in the same flex cluster with an even gap, so a selected item in each reads as two-of-four selected. A divider and tighter intra-group spacing separate them.

**Tech stack:** Next.js 16 client component, Tailwind, the project's ToggleGroup UI primitive.

## Global constraints

- No new lint or type problem over baseline. tsc clean, lint 0 errors.
- npm and node are not on the default PATH from the shell. Export `PATH="/opt/homebrew/bin:$PATH"` first.
- filter-bar.tsx is a client component using useRouter/useSearchParams, which this repo does not render-test. The change is visual, verified by tsc, lint, and a browser QA pass, not a unit test.
- Prose in docs follows the humanizer rules. Code and identifiers are left as they are.

---

### Task 1: Separate the layout and density toggle groups

**Files:**
- Modify: `src/components/feed/filter-bar.tsx` (the `ml-auto` cluster, around lines 351 to 397)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: See the current grouping**

Read `src/components/feed/filter-bar.tsx` lines 351 to 397. The layout ToggleGroup (grid/list, lines 365 to 376) and the density ToggleGroup (comfortable/compact, lines 385 to 396) are siblings inside `<div className="ml-auto flex items-center gap-2">`, so the four icons sit at an even gap.

- [ ] **Step 2: Add a divider between the two groups and tighten each group**

Change the `ml-auto` container to hold each toggle group with its own tighter internal spacing and a thin divider between them. Replace the container opening tag (line 351) and insert a divider between the two ToggleGroups.

Container (line 351), give the two groups a smaller gap so the divider carries the separation:

```tsx
        <div className="ml-auto flex items-center gap-1.5">
```

Between the layout ToggleGroup's closing `</ToggleGroup>` (line 376) and the density comment/ToggleGroup (line 378 onward), add a divider:

```tsx
          </ToggleGroup>

          <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

          {/* Same kind of control as the grid/list toggle above ... (existing comment) */}
          <ToggleGroup
```

The Sort select stays first in the cluster with its existing gap; the divider only sits between the two icon toggle groups so they read as two controls, not four.

- [ ] **Step 3: Verify it compiles and lints**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
npm run lint
```
Expected: tsc clean, lint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/feed/filter-bar.tsx
git commit -m "fix(feed): separate the layout and density toggle groups in the toolbar"
```

---

## Final verification

- [ ] `npm run lint` 0 errors, `npm run typecheck` clean, `npm test` green.
- [ ] Browser QA (deferred): the layout and density toggles read as two distinct groups; the selected item in each is unambiguous.

## Self-review notes

- Spec coverage: this is M3-U2. The change is purely visual, so its gate is tsc, lint, and the browser QA pass, matching the repo norm of not render-testing this component.
- M3-U3 (list virtualization) is deliberately not here. In this layout the feed scrolls in a nested overflow container owned by the server-component page, so virtualization needs the scroll container restructured plus a new dependency, and the Perf-runtime review measured zero jank. It belongs in its own spike-first plan, or can be dropped given no measured jank.
