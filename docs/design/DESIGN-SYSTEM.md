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
--faint           #868682   captions, units, timestamps
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

### 2.1 Chart palettes

Two palettes, and picking between them is a meaning decision rather than a taste one.

Magnitude uses the score ramp above (`--score-1` through `--score-5`). Reach for it only
when the thing being encoded really is a magnitude, because that ramp escalates and amber
means anomaly. The ranking bars are the current example.

Categorical tells series apart when the difference between them carries no ordering. It is
deliberately neutral: a producer's identity is not a "which is more" reading, so painting it
amber would spend the score's one meaning on a channel name. The tokens alias the four
neutral inks instead of adding hues, so the amber law holds by construction.

```
--chart-categorical-1   = --foreground
--chart-categorical-2   = --line-strong
--chart-categorical-3   = --muted-foreground
--chart-categorical-4   = --faint
```

They alias rather than copy hex, so the light block in section 10 retunes them with the
inks and the two sets cannot drift apart. The producer donut is the current consumer. Four
entries is the honest ceiling: past four distinct neutrals the series stop being separable,
so a chart with more series folds its tail into "Other" rather than cycling the ramp.

Charts take color from one of these two palettes. No chart declares its own hex.

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
--faint           #64625b
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
