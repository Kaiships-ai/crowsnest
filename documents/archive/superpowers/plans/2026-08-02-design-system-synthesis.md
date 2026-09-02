# Design system synthesis implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse five overlapping, partly contradictory design sources into one canonical doc plus a reconciled `globals.css`, and archive the superseded files.

**Architecture:** Write `docs/design/DESIGN-SYSTEM.md` as the single source of truth. Its token values match what already ships in `globals.css`; its rules come from Kai's law doc. Add a light-theme token block to `globals.css` (dark stays the default). Move the three superseded design-system sources into `docs/design/_archive/`.

**Tech Stack:** Next.js 16, Tailwind v4 (`@theme inline` in `globals.css`), Archivo + IBM Plex Mono fonts, plain markdown for the doc.

## Global constraints

- Humanizer hook blocks any write to `.md` containing em dashes, en dashes, or curly quotes. Every doc step must pass it. Use straight quotes and periods/commas/parentheses only.
- Precedence rule for all reconciliation: shipped/prototype wins on token VALUES, the law doc wins on RULES.
- Do not rename code identifiers in this plan. The vocabulary table is documented as law; the actual `sidecar` to `local service` rename is a separate pass.
- Do not wire a theme toggle. Light tokens are added, but nothing switches to them yet.
- Dark is the default theme, defined on `:root`. Light is an override block only.
- Token names in `globals.css` do not change. Only a light override block is added.

---

### Task 1: Write the canonical design-system doc

**Files:**
- Create: `docs/design/DESIGN-SYSTEM.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the canonical doc other tasks and future work reference by path `docs/design/DESIGN-SYSTEM.md`.

- [ ] **Step 1: Create the doc with the full content below**

Write `docs/design/DESIGN-SYSTEM.md` verbatim:

```markdown
# Crowsnest design system

The single source of truth for tokens and visual rules. Where an older doc disagrees with this one, this one wins. Token values match what ships in `src/app/globals.css`; the rules come from Kai's law doc (now archived under `_archive/`).

Product in one line: a relative-outlier tool. A post is judged against the median of its own channel, not against absolute views. Every design choice serves finding the anomaly fast.

## 1. Three root principles

### 1.1 No self-explaining UI
If an element needs a sentence to justify its existence, the element is wrong, not the sentence missing. Total explanation budget for the whole app: zero, with exactly two exceptions: the first-run empty state, and error states (which say how to fix).

### 1.2 One concept, one name, one place
Every piece of information appears once per screen. If a banner already says "Removed from Instagram," there is no REMOVED badge and no second label saying the same thing.

### 1.3 Silence is the default
Normal state (healthy, synced, nothing unusual) carries no color, no icon, no badge. Only the anomaly rises. A table of seven healthy channels looks almost empty.

## 2. Color tokens

These are the shipped values from `globals.css`. Dark is the committed default. Light values are in section 8.

```
--background      #0b0b0c   app ground
--card            #141416   panel, card, raised row
--popover         #1c1c1f   hover, overlay surface
--border          #1f1f23   table rules, section dividers
--line-strong     #3e3e46   input borders, strong rules
--input           #3e3e46   form borders

--foreground      #f2f2f0   primary text, numbers
--muted-foreground #9a9a96  labels, metadata
--faint           #6b6b68   captions, units, timestamps
--dim             #55554f   dimmest ink

--primary         #e8a33d   amber, see section 3
--destructive     #d9503f   blocking error
--pos             #6fad86   positive verdict, see section 3.1
```

No gradients. No shadows in dark. Layer with `--card` and `--border` instead.

Score tokens (the amber family, magnitude encoding):
```
--score           #e8a33d
--score-on        #0b0b0c   text on a solid score fill
--score-wash      rgba(232,163,61,0.12)   score badge background
--score-line      rgba(232,163,61,0.35)   score badge border
--score-1         #e8a33d   brightest, highest magnitude
--score-2         #c0842f
--score-3         #8f6524
--score-4         #66481a
--score-5         #463212   dimmest
```

## 3. The amber law (most important)

Amber has one meaning: this is an anomaly worth looking at.

Allowed on amber:
- Score badge (for example `10.1x`) and the score gauge bar
- Chart columns or cells for a post that beat its channel median
- Exactly one primary action per screen

Banned on amber:
- Active nav item. Use `--card` background plus `--foreground` plus a 2px `--line-strong` bar on the left.
- Selected toggle or segmented control. Use `--card` plus `--foreground`.
- Logo, checklist, progress bar, sidebar count badge
- Any secondary button

Budget: at most one large amber area plus N score badges per viewport. If you count more than one large amber area, cut.

### 3.1 The green rule

Green (`--pos`, `#6fad86`) is allowed only on an explicit positive verdict or live status: a service running, a "High confidence" reading, a completed step, a good delta arrow. It is banned as resting-state decoration. A healthy channel row stays uncolored; "all synced" is not painted green as reassurance. This keeps 1.3 (silence is default) while matching what ships.

## 4. Typography

Two families. Archivo for everything that is words (weights 400, 500, 600, 700). IBM Plex Mono for everything that is a number, ID, timestamp, or system status (weights 400, 500), always `tabular-nums slashed-zero`.

Hard rule: if it is a number, it is mono and tabular. Numeric table columns are right-aligned. This is what makes the app read as an analysis tool.

Type scale, six steps, no others:
```
34   page titles, the score at display size
24   card and section titles
19   lead copy
17   body, captions
15   mono values, meta
13   mono labels, column heads, units
```

Uppercase appears only on column heads and sidebar group labels (`letter-spacing: 0.06em`). Nowhere else. Copy uses sentence case, including buttons.

## 5. Space and shape

- Spacing scale only: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Any other number is wrong.
- Radius: 0 on cards, tables, inputs, and badges. Buttons are pills (`border-radius: 999px`). No other radius anywhere.
- Border: 1px `--border`. Borders divide regions, they do not decorate.
- Table row height: 56px fixed.
- Content max-width: 1120px, left-aligned to the sidebar. Feed and Remix Studio go full-bleed inside the content column.
- Focus: 2px amber outline, offset 2.

## 6. Vocabulary (law, code rename is a later pass)

One concept, one word, across the whole app. The buttons and their results share the verb: a `Sync` button produces a `Synced` toast.

| Concept | Word to use | Do not use |
|---|---|---|
| The local Python service | local service | sidecar, proxy, local model, service |
| Pulling data down | Sync (the verb, everywhere) | Run, Refresh, Fetch, Update |
| The above-median ratio | score | multiplier, outlier ratio, x-value |
| The user's own channel | My channel | your channel, own channel |
| A published item | post | video, item, content |

Note: the code still says `sidecar` in about ten components. That rename is tracked as separate work, not part of this design-system doc.

## 7. Component rules

Table:
- Numeric columns right-aligned, mono, tabular.
- Row action buttons (Sync and similar) are hidden by default and appear on row hover, except a row that is errored or stale, which shows them always. Never repeat a button on all seven rows at once.
- Normal row: no color, no icon. Anomalous row: a 6px dot plus a status label.
- Do not mix two object types in one table. Tracked channels and My channel go in separate sections.

Card:
- Exactly one headline per card. If the text over the image is the hook, drop the title below it, and the reverse. Never two competing title lines.
- Every metric has a text label, not an icon alone. `10.1x score`, `2.27M views`, `4.1% engagement`.
- At most three metrics. The fourth goes to the detail page.
- No progress bar unless it can say what it measures.

Sidebar badge: count only. Do not put a score or quota where the count lives.

Chart: the legend must match the data. If it says "amber = beat this channel median," then by definition about half the cells are amber. A large mismatch is a logic or label bug, fix before ship.

Tab: the default tab is the first in the workflow, not the prettiest. Before analysis exists, open the first tab (raw source), never an empty result tab.

## 8. State rules

- State numbers read from one source. If the sidebar says 6/6 synced and another screen says 5/6, that is a P0 bug.
- When the local service is down, every control that depends on it is disabled at opacity 0.4 with a tooltip that says the service must be running. Never leave a button lit amber that only errors on click.
- Error banner has four parts and no more: `[label] [what happened plus its effect] [error code, time checked] [fix action]`. It shows once at the top, never repeated per row.
- Empty state: one sentence naming what is missing, one button naming what to do. No mechanism explanation.

## 9. Layout rules

- No dead columns. If one side of the screen is more than half empty while the other must scroll, redistribute. Important numbers do not fall below the fold while half the screen sits dark.
- Onboarding checklist is dismissible and collapses to one line after the first completion.

## 10. Light theme

Dark is the committed default and lives on `:root`. Light is an override block (`[data-theme="light"]`) with the same token names. Nothing toggles to it yet; the tokens exist so a switch is additive later.

```
--background      #f4f2ef
--card            #eae7e1
--popover         #e2dfd8
--border          #dcd8d0
--line-strong     #b0aba1
--foreground      #17150f
--muted-foreground #57554f
--faint           #7f7c75
--dim             #8c887f
--primary         #a85f00
--primary-foreground #fbf9f6
--pos             #2f6b4a
--destructive     #ae2818
--score-1..5      #8a5707 #a97b22 #c39f55 #d8bc8b #e7d8bc
```

Light adds a soft elevation shadow (`0 2px 14px rgba(23,21,15,0.16)`) where dark uses none. That is the one place the no-shadow rule relaxes, because flat surfaces on a light ground lose their edge.

## 11. Ship checklist

Count, do not eyeball:

1. Large amber areas on the viewport: 1 or fewer (score badges do not count).
2. Every sentence read: delete any that explains why an element exists.
3. Each fact appears once: no badge, banner, and label saying the same thing.
4. Every number is mono, tabular, and right-aligned if in a table.
5. Every state number matches the other screens.
6. Every unavailable control is disabled, no "lit but errors on click."
7. Every metric has a text label.
8. One headline per card.
9. Chart legend matches the visible data.
10. No filter or chip showing with count 0.
11. No empty region wider than half the screen next to a scrolling one.
12. Words match the section 6 vocabulary.

## Provenance

Reconciled from: `globals.css` (shipped values), the archived law doc `_archive/crowsnest-design-system.md` (rules), and `_archive/from-claude-design/RECONCILED.md` (the prototype-wins decision). The stale purple spec `_archive/DESIGN.md` (v0.2) is superseded in full.
```

- [ ] **Step 2: Verify the write was accepted by the humanizer hook**

Run: `test -f docs/design/DESIGN-SYSTEM.md && echo EXISTS`
Expected: `EXISTS`. If the write was blocked, the hook printed the offending characters. Replace any em dash, en dash, or curly quote with straight equivalents and write again.

- [ ] **Step 3: Verify no banned punctuation slipped in**

Run: `grep -nP "[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}]" docs/design/DESIGN-SYSTEM.md || echo CLEAN`
Expected: `CLEAN`

- [ ] **Step 4: Commit**

```bash
git add docs/design/DESIGN-SYSTEM.md
git commit -m "docs(design): canonical design system, single source of truth"
```

---

### Task 2: Add the light-theme token block to globals.css

**Files:**
- Modify: `src/app/globals.css` (the `:root` block ends at line 132 today; add a new block after it)

**Interfaces:**
- Consumes: the existing `:root` dark tokens (names must match exactly).
- Produces: a `[data-theme="light"]` override so setting that attribute on the root element swaps the palette. No toggle is wired.

- [ ] **Step 1: Confirm current root block shape**

Run: `grep -n "color-scheme\|^:root\|--radius: 0rem" src/app/globals.css`
Expected: `:root` opens near line 67 with `color-scheme: dark`, and `--radius: 0rem` sits just before the closing brace near line 131. Note the exact closing brace line.

- [ ] **Step 2: Add the light override block after the :root closing brace**

Insert this block immediately after the `:root { ... }` block closes (after the line containing `--radius: 0rem;` and its closing `}`), before `@layer base {`:

```css
/**
 * Light theme. Same token names, ported from the prototype's [data-theme="light"]
 * block. Dark stays the default on :root; nothing toggles this yet. Setting
 * data-theme="light" on <html> swaps the palette. Light is the one place the
 * no-shadow rule relaxes: flat surfaces on a light ground need an edge.
 */
[data-theme="light"] {
  color-scheme: light;

  /* ground */
  --background: #f4f2ef;
  --card: #eae7e1;
  --card-foreground: #17150f;
  --popover: #e2dfd8;
  --popover-foreground: #17150f;
  --muted: #e2dfd8;
  --accent: #e2dfd8;
  --accent-foreground: #17150f;

  /* ink */
  --foreground: #17150f;
  --muted-foreground: #57554f;
  --faint: #7f7c75;
  --dim: #8c887f;

  /* rules */
  --border: #dcd8d0;
  --line-strong: #b0aba1;
  --input: #b0aba1;

  /* amber primary */
  --primary: #a85f00;
  --primary-foreground: #fbf9f6;
  --secondary: #e2dfd8;
  --secondary-foreground: #17150f;

  /* score */
  --score: #a85f00;
  --score-on: #fbf9f6;
  --score-wash: rgba(168, 95, 0, 0.16);
  --score-line: rgba(168, 95, 0, 0.5);
  --score-1: #8a5707;
  --score-2: #a97b22;
  --score-3: #c39f55;
  --score-4: #d8bc8b;
  --score-5: #e7d8bc;

  /* failure */
  --destructive: #ae2818;
  --destructive-foreground: #fbf9f6;
  --destructive-wash: rgba(174, 40, 24, 0.11);

  /* healthy verdict */
  --pos: #2f6b4a;

  /* focus and selection */
  --ring: #a85f00;
  --selection: rgba(168, 95, 0, 0.2);

  /* hatching and elevation */
  --hatch-1: rgba(23, 21, 15, 0.05);
  --hatch-2: rgba(23, 21, 15, 0.17);
  --shade: 23, 21, 15;
  --elev: 0 2px 14px rgba(23, 21, 15, 0.16);
}
```

- [ ] **Step 3: Build to confirm the CSS compiles**

Run: `npm run build`
Expected: build completes with no CSS error. The `[data-theme="light"]` block is inert until something sets the attribute, so no visual output changes.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(design): add light theme token block, dark stays default"
```

---

### Task 3: Archive the superseded design-system sources

**Files:**
- Create: `docs/design/_archive/` (directory)
- Move (tracked): `docs/design/DESIGN.md` to `docs/design/_archive/DESIGN.md`
- Move (tracked): `docs/design/from-claude-design/` to `docs/design/_archive/from-claude-design/`
- Move (untracked): `Crowsnest UI Mockups/uploads/crowsnest-design-system.md` to `docs/design/_archive/crowsnest-design-system.md`

**Interfaces:**
- Consumes: `docs/design/DESIGN-SYSTEM.md` from Task 1 exists (its provenance section points at these archived paths).
- Produces: a single live design-system doc, with the three superseded sources under `_archive/`.

- [ ] **Step 1: Create the archive directory**

Run: `mkdir -p docs/design/_archive`

- [ ] **Step 2: Move the two git-tracked sources**

```bash
git mv docs/design/DESIGN.md docs/design/_archive/DESIGN.md
git mv docs/design/from-claude-design docs/design/_archive/from-claude-design
```
Expected: no error. These were confirmed tracked.

- [ ] **Step 3: Move the untracked law doc, then stage it**

```bash
mv "Crowsnest UI Mockups/uploads/crowsnest-design-system.md" docs/design/_archive/crowsnest-design-system.md
git add docs/design/_archive/crowsnest-design-system.md
```
The law doc lives in an untracked folder, so `git mv` would fail. Plain `mv` plus `git add` is correct.

- [ ] **Step 4: Check nothing references the old paths**

Run: `grep -rn "design/DESIGN.md\|from-claude-design\|uploads/crowsnest-design-system" --include=*.md --include=*.ts --include=*.tsx . | grep -v "_archive\|docs/superpowers/plans/2026-08-02"`
Expected: no live references outside the archive and this plan. If a doc (for example `CONTEXT.md` or `README.md`) points at a moved path, update it to `docs/design/DESIGN-SYSTEM.md`.

- [ ] **Step 5: Confirm globals.css comment still points somewhere valid**

Run: `grep -n "from-claude-design\|Crowsnest Prototype\|crowsnest-design-system" src/app/globals.css`
Expected: the header comment near line 8 to 10 mentions `docs/design/from-claude-design/`. Update that path to `docs/design/_archive/from-claude-design/` so the pointer stays accurate.

- [ ] **Step 6: Commit**

```bash
git add -A docs/design "Crowsnest UI Mockups" src/app/globals.css
git commit -m "docs(design): archive superseded design sources under _archive"
```

---

### Task 4: Final verification

**Files:**
- None modified. Verification only.

**Interfaces:**
- Consumes: all prior tasks committed.
- Produces: a green build, test, and lint run confirming the cleanup broke nothing.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Test**

Run: `npm test`
Expected: the suite passes (about 560 tests per the last recorded run in RECONCILED). No test asserts on the moved doc paths; if one does, it is a stale reference to fix.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Confirm one live design-system doc remains**

Run: `find docs/design -maxdepth 1 -name "DESIGN*.md"`
Expected: only `docs/design/DESIGN-SYSTEM.md`. `DESIGN.md` is under `_archive/`.

---

## Self-review

Spec coverage against the seven grilling decisions:
- Deliverable (one doc plus matching CSS, archive rest): Tasks 1, 2, 3.
- Precedence (shipped values, law rules): baked into Task 1 doc content and stated in Global constraints.
- Green kept, constrained to verdicts: section 3.1 of the doc.
- Table row 56px: section 5.
- Vocabulary as law, rename later: section 6 plus Global constraints.
- Max width 1120px: section 5.
- Light tokens added now, no toggle: Task 2, section 10, Global constraints.

Placeholder scan: no TBD or "handle edge cases." Every step has a concrete command or file content.

Type and path consistency: token names in the Task 2 light block match the `:root` names read from the current `globals.css`. Archive paths in Task 3 match the provenance section written in Task 1.

Open item flagged, not blocking: light theme has tokens but no toggle. A switch is future work.
