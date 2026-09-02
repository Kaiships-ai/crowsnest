# Content machine v1, studio shell plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the terminal-independent half of the Create studio: a video_kind picker on the plan dialog, a single-planned-post loader with its brief, a full-bleed studio route and shell (brief pane populated, terminal and output panes as placeholders), a Create in Studio entry point, and a published-plan visual on the calendar.

**Architecture:** All of this depends only on merged foundations (the video_kind column, studio/paths.ts). The web terminal, the in-session /ksa:cooking and /ksa:serve, and the auto-record-on-publish come in later plans and slot into the placeholders this plan leaves. So this plan can build in parallel with the web-terminal work.

**Tech stack:** Next.js 16 (app router, (shell) route group), React 19, drizzle + better-sqlite3, vitest. Design system: docs/design/DESIGN-SYSTEM.md (dark, radius 0, pill buttons, amber only on one primary action, Archivo + IBM Plex Mono).

## Global constraints

- npm and node are not on the Bash PATH. Prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- This is a modified Next.js. Read node_modules/next/dist/docs/ before writing route or server code.
- Reuse existing ui primitives (src/components/ui): Select, Button, Card, Dialog, ToggleGroup, Resizable, Tabs. Do not invent components.
- Design system: amber (--primary) on exactly one primary action per screen. Score badges are the one amber the law allows. Green (--pos) only on a positive verdict. Numbers are IBM Plex Mono tabular. Radius 0 on cards/inputs, pill buttons, no shadows. Vocabulary: "My channel", "post", "score".
- video_kind allow-list lives in src/server/services/video-kind.ts (VIDEO_KINDS, DEFAULT_VIDEO_KIND = "explainer"). The column is nullable; an unset kind is null.
- The planned-post write action already accepts videoKind (create and update). Only the dialog and the new query need wiring.
- UI wiring that a unit test cannot exercise (a client form, a page render) is verified by the controller in the browser, not by the implementer. State that as the verification step; do not fake a test.
- Tests use vitest. Leave the full suite green.

## File structure

- Modify: src/components/mine/plan-dialog.tsx (video_kind Select + wiring, Create in Studio button)
- Modify: src/server/queries/planned-posts.ts (getPlannedPostById)
- Create: src/server/queries/studio.ts (the brief loader composing plan + video detail)
- Create: src/app/(shell)/mine/[postId]/studio/page.tsx (full-bleed route)
- Create: src/components/studio/studio-screen.tsx (the 3-pane shell)
- Modify: src/components/layout/topbar.tsx (ROUTE_TITLES entry)
- Modify: src/components/mine/mine-calendar.tsx (published-plan visual)

---

## Task 1: video_kind picker on the plan dialog

**Files:**
- Modify: `src/components/mine/plan-dialog.tsx`

**Interfaces:**
- Consumes: `VIDEO_KINDS`, `DEFAULT_VIDEO_KIND` from `@/server/services/video-kind`; `createPlannedPostAction`/`updatePlannedPostAction` already accept `videoKind`.
- Produces: the dialog sends `videoKind` on create and on edit.

- [ ] **Step 1: Add videoKind state**

In `plan-dialog.tsx`, near the other `useState` fields (around :66-71), add:

```tsx
const [videoKind, setVideoKind] = useState<string>(plan?.videoKind ?? "");
```

- [ ] **Step 2: Render the picker after the Script Select**

After the Script `Select` block (around :198), add a labelled field group matching the existing `flex flex-col gap-1.5` + `Label` pattern, copying the Script Select shape. Import `VIDEO_KINDS` from `@/server/services/video-kind`:

```tsx
<div className="flex flex-col gap-1.5">
  <Label htmlFor="plan-video-kind">Video kind</Label>
  <Select value={videoKind || "none"} onValueChange={(v) => setVideoKind(v === "none" ? "" : v)}>
    <SelectTrigger id="plan-video-kind"><SelectValue placeholder="Not set" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="none">Not set</SelectItem>
      {VIDEO_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 3: Pass videoKind on create**

In the create call (around :91-96), add `videoKind: videoKind || undefined` to the `createPlannedPostAction({...})` input.

- [ ] **Step 4: Pass videoKind on edit**

In the edit path (around :110-111), when `isEdit`, include `videoKind: videoKind || null` in the `updatePlannedPostAction(id, {...})` patch (the action accepts `string | null`). Only send it if changed from `plan?.videoKind ?? ""` to avoid a needless write, matching the file's changed-fields-only edit style.

- [ ] **Step 5: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/components/mine/plan-dialog.tsx`
Expected: clean.

- [ ] **Step 6: Verification (controller browser check)**

This is a client form; no unit test. The controller verifies in the browser: open the plan dialog, the Video kind picker shows the eight kinds plus Not set, selecting one and saving persists it (re-open shows it), and editing changes it. Report DONE_WITH_CONCERNS if any step needs runtime confirmation the implementer cannot do.

- [ ] **Step 7: Commit**

```bash
git add src/components/mine/plan-dialog.tsx
git commit -m "feat(planner): video_kind picker on the plan dialog"
```

---

## Task 2: single planned-post loader and studio brief query

**Files:**
- Modify: `src/server/queries/planned-posts.ts` (add `getPlannedPostById`)
- Create: `src/server/queries/studio.ts` (the brief loader)
- Create: `src/server/queries/studio.test.ts`

**Interfaces:**
- Produces: `getPlannedPostById(id: string): Promise<PlannedPostRow | null>` (same row shape the calendar uses, including `videoKind`, `scriptTitle`, `scriptId`, `sourceVideoId`). `getStudioBrief(postId: string): Promise<{ plan: PlannedPostRow; video: VideoDetail | null } | null>` composing the plan with `getVideoDetail(plan.sourceVideoId)` for the brief pane. Returns null when the plan does not exist.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/queries/studio.test.ts
// Mirror the db-seeding harness used by src/server/queries/planned-posts.test.ts
// (find it and copy its beforeEach/migrate setup). Seed a planned post with a videoKind
// and a linked script; assert getStudioBrief returns the plan with videoKind and, when a
// sourceVideoId is set, a video object, and returns null for an unknown id.
```

Write the concrete test against the real db harness the planned-posts tests use. Assert: `getPlannedPostById(id)` returns the row with `videoKind` set; `getStudioBrief(id)` returns `{ plan, video }`; both return null for a missing id.

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/queries/studio.test.ts`
Expected: FAIL (functions not defined).

- [ ] **Step 3: Add getPlannedPostById**

In `src/server/queries/planned-posts.ts`, add an exported `getPlannedPostById(id)` modeled on the private `getPlan` in planned-post-actions.ts (:31) plus the script-title join already in `getPlannedPosts` (:107-113), returning the same `PlannedPostRow` shape (or null).

- [ ] **Step 4: Implement getStudioBrief**

```ts
// src/server/queries/studio.ts
import { getPlannedPostById, type PlannedPostRow } from "./planned-posts";
import { getVideoDetail, type VideoDetail } from "./video";

export async function getStudioBrief(postId: string): Promise<{ plan: PlannedPostRow; video: VideoDetail | null } | null> {
  const plan = await getPlannedPostById(postId);
  if (!plan) return null;
  const video = plan.sourceVideoId ? await getVideoDetail(plan.sourceVideoId) : null;
  return { plan, video };
}
```

Confirm the exact `PlannedPostRow` and `VideoDetail` export names in those files and adjust imports to match.

- [ ] **Step 5: Run the test and watch it pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/queries/studio.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/queries/planned-posts.ts src/server/queries/studio.ts src/server/queries/studio.test.ts
git commit -m "feat(studio): single planned-post loader and brief query"
```

---

## Task 3: studio route, shell, and Create in Studio entry

**Files:**
- Create: `src/app/(shell)/mine/[postId]/studio/page.tsx`
- Create: `src/components/studio/studio-screen.tsx`
- Modify: `src/components/layout/topbar.tsx` (ROUTE_TITLES)
- Modify: `src/components/mine/plan-dialog.tsx` (Create in Studio button)

**Interfaces:**
- Consumes: `getStudioBrief` (Task 2).
- Produces: the route `/mine/[postId]/studio` rendering `<StudioScreen brief={...} />`, a full-bleed 3-pane shell with the brief pane populated and the terminal + output panes as clearly-labelled placeholders (the later plans fill them), and a Create in Studio control that navigates there.

- [ ] **Step 1: Add the route title**

In `src/components/layout/topbar.tsx` (ROUTE_TITLES around :26-28), add an entry matching the remix pattern:

```tsx
{ pattern: /^\/mine\/[^/]+\/studio$/, title: "Studio" },
```

- [ ] **Step 2: Create the route page (full-bleed, no max-width wrapper)**

```tsx
// src/app/(shell)/mine/[postId]/studio/page.tsx
import { notFound } from "next/navigation";
import { getStudioBrief } from "@/server/queries/studio";
import { StudioScreen } from "@/components/studio/studio-screen";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const brief = await getStudioBrief(postId);
  if (!brief) notFound();
  return <StudioScreen brief={brief} />;
}
```

Mirror the full-bleed shape of `feed/[videoId]/remix/page.tsx` (no `mx-auto max-w-*` wrapper).

- [ ] **Step 3: Build the shell component**

Create `src/components/studio/studio-screen.tsx` (client component), a three-column full-height layout matching the mockup and the design system (radius 0, dark, the panes divided by 1px `--border`):
- Left, Brief: the plan title, video_kind (a score badge if the source has a score), the script content (from `brief.plan.scriptTitle` and, if you load it, the script body; if the body is not on the row, show the title and the source link), and the frame pass visual layout from `brief.video.analysis.layout` (onScreenText, textPosition, cutRhythm, framing) when present, degrading to "frame pass not run" when null.
- Center, Claude Code: a placeholder panel with the label "Claude Code" and copy "Terminal connects here" (the web-terminal plan wires this). Do not build a fake terminal.
- Right, Output: a 9:16 preview placeholder, and a disabled Publish button reading neutral (not amber) with a hint "Publish unlocks when the render completes" plus a Save to calendar secondary. The later plan enables Publish and wires /ksa:serve.

Use the design tokens by name. Amber appears on nothing here yet (Publish is disabled/neutral until the render plan lands), which satisfies the amber law for this shell state.

- [ ] **Step 4: Add the Create in Studio control**

In `plan-dialog.tsx`, add a Create in Studio button in the edit-mode footer (only when `isEdit`, so the post exists and has an id) that navigates to `/mine/${plan.id}/studio` via the router. It is a secondary/pill button; the dialog's existing Save stays the one primary. Import and use the app's router (`next/navigation` useRouter).

- [ ] **Step 5: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/app/\(shell\)/mine/\[postId\]/studio/page.tsx src/components/studio/studio-screen.tsx src/components/layout/topbar.tsx src/components/mine/plan-dialog.tsx`
Expected: clean.

- [ ] **Step 6: Verification (controller browser check)**

No unit test for the page render. The controller verifies: navigating to a plan's studio shows the three panes, the brief pane is populated from the plan and its source video, the terminal and output panes read as labelled placeholders, and Publish is disabled with the hint. Report DONE_WITH_CONCERNS noting the browser check is owed.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(shell)/mine/[postId]/studio/page.tsx" src/components/studio/studio-screen.tsx src/components/layout/topbar.tsx src/components/mine/plan-dialog.tsx
git commit -m "feat(studio): full-bleed studio route and shell with Create in Studio entry"
```

---

## Task 4: published-plan visual on the calendar

**Files:**
- Modify: `src/components/mine/mine-calendar.tsx`

**Interfaces:**
- Consumes: `PlannedPostRow.publishedOwnPostId` (already on the row).
- Produces: a distinct visual on the calendar (a cell overlay or a badge in the day panel) when a plan has `publishedOwnPostId` set, so a plan published from the studio reads as published.

- [ ] **Step 1: Read how the calendar renders a plan cell**

Read `mine-calendar.tsx` (buildGrid, CellKind, CELL_STYLE, the day-panel plan branch). Note where a plan's `publishedOwnPostId` is available on the cell/plan object.

- [ ] **Step 2: Add the published-plan visual**

When a plan on a day has `publishedOwnPostId !== null`, render a distinct marker on that cell (a small green `--pos` square or a "published" tag in the day panel plan branch), keeping the design system (green only on this positive verdict, no amber). Do not duplicate the existing own-post reach cell; this marks the plan itself as published.

- [ ] **Step 3: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/components/mine/mine-calendar.tsx`
Expected: clean.

- [ ] **Step 4: Optional unit test for buildGrid**

If `buildGrid` (or the cell-kind derivation) is a pure exported function, add a vitest asserting a plan with `publishedOwnPostId` set yields the published-plan marker. If it is not exported/pure, skip and note the controller browser check owes this.

- [ ] **Step 5: Full suite + verification**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: all pass. Controller browser-verifies the published marker renders.

- [ ] **Step 6: Commit**

```bash
git add src/components/mine/mine-calendar.tsx
git commit -m "feat(planner): published-plan marker on the calendar"
```

---

## Self-review notes

- Spec coverage: this plan covers the plan-dialog video_kind picker, the studio route + shell, and the published-plan visual from the wireframes. It leaves the terminal pane, the Publish action, and the auto-record on publish as placeholders for the web-terminal and studio-wiring plans.
- Several tasks are client UI whose verification is a controller browser check, stated explicitly. The data-layer task (Task 2) is properly unit-tested.
- The studio screen must not build a fake terminal; the center pane is a labelled placeholder until the web-terminal plan wires the real xterm connection.
