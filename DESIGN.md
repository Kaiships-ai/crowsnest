---
name: Crowsnest
description: An instrument panel for creators — sharp, monospaced, and lit by a single amber signal.
colors:
  ground: "#0b0b0c"
  card: "#141416"
  ink: "#f2f2f0"
  muted-ink: "#9a9a96"
  faint: "#868682"
  dim: "#55554f"
  border: "#1f1f23"
  line-strong: "#3e3e46"
  amber: "#e8a33d"
  amber-on: "#0b0b0c"
  amber-wash: "rgba(232, 163, 61, 0.12)"
  pos: "#6fad86"
  destructive: "#d9503f"
  destructive-wash: "rgba(217, 80, 63, 0.12)"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    fontFeature: "tabular-nums slashed-zero"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    letterSpacing: "0.06em"
rounded:
  surface: "0px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-on}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-on}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-outline:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  surface-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "16px"
  input-field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "8px 10px"
---

# Design System: Crowsnest

## Overview

**Creative North Star: "The Instrument Panel"**

Crowsnest looks like a precise measuring tool, not a marketing surface. The screen is a
panel of readouts: neutral by default, dense with real numbers, and lit by a single amber
signal that means one thing only — this post beat its channel's own median. Everything that
is not that signal recedes to a graded neutral scale, so the eye lands on the anomaly the
way it lands on the one warm light on a dark console. The system runs dark by default
(near-black ground) and swaps to a warm-paper light theme; both keep the same discipline.

The type does the tool's work. Display and body are set in Archivo, a grotesque that stays
quiet at reading sizes and firm at title sizes; every number, unit, label, and status tag is
set in IBM Plex Mono with tabular, slashed-zero figures, because aligned digits are what make
a surface read as an instrument rather than a webpage. Corners are square on every surface —
cards, inputs, wells, panels — and the only rounded thing in the product is the button, a
pill that reads as the one place you act. Depth is nearly absent: the dark theme is flat and
separates planes by tonal steps, and only the light theme is allowed a single soft elevation
because a flat surface on paper needs one edge to sit on.

**Key Characteristics:**
- Amber is a signal, not a brand color — reserved for the score and one action per screen.
- Every number is monospaced and tabular; uppercase appears only on column heads and group labels.
- Square corners on all surfaces; pill only on buttons.
- Flat by default; depth is tonal, not shadowed (light theme excepted).
- Dark-first, with a warm-paper light theme carrying the same rules.

## Colors

A graded neutral field with exactly two meaningful hues: amber for "beat the median," red for failure. Everything else is ink on ground.

### Primary
- **Signal Amber** (#e8a33d dark / #a85f00 light): The one voice. Used on the score readout and on at most one primary action per screen — the filled button. Its `amber-wash` (rgba 0.12) and `amber-line` (rgba 0.35) back the score in situ. Nothing else may borrow it.

### Neutral
- **Console Ground** (#0b0b0c dark / #f4f2ef light): The page. Near-black on dark, warm paper on light.
- **Raised Card** (#141416 dark / #eae7e1 light): Panels, wells, cards, and the left rail — a tonal step up from ground, never a shadowed float.
- **Readout Ink** (#f2f2f0 dark / #17150f light): Primary text and live values.
- **Muted Ink** (#9a9a96 dark / #57554f light): Secondary text and descriptions.
- **Faint Ink** (#868682 dark / #64625b light): Labels, meta, and de-emphasized units; tuned to hold AA at 13px on card.
- **Dim Ink** (#55554f dark / #8c887f light): The quietest tier — placeholders and locked-state marks.
- **Hairline** (#1f1f23 dark / #dcd8d0 light) and **Strong Line** (#3e3e46 dark / #b0aba1 light): The two rule weights; borders and dividers do the separating that shadows would elsewhere.

### Tertiary
- **Verdict Green** (#6fad86 dark / #2f6b4a light): The healthy counterpart to failure — "connected," "ready," a passing check. Deliberately muted: a loud green would compete with amber, and only amber may shout.
- **Failure Red** (#d9503f dark / #ae2818 light): Errors and destructive intent, with a 0.12 wash for its surfaces.

### Named Rules
**The Amber Law.** Amber means exactly one thing: this beat its channel's median. It is allowed on the score and on one primary action per screen. It is banned on nav-active state, toggles, secondary buttons, the logo, progress bars, and count badges — those use a raised neutral surface instead. The budget is enforced by usage, not by the token.

**The Two-Hue Rule.** The only chromatic colors are amber (signal) and red (failure), with green as the muted positive verdict. Series and categories are told apart with the four neutral inks, never with invented hues — identity carries no "which is more" reading.

## Typography

**Display / Body Font:** Archivo (with ui-sans-serif, system-ui fallback)
**Label / Mono Font:** IBM Plex Mono (with ui-monospace, SFMono-Regular fallback)

**Character:** A plain grotesque paired with a technical monospace. Archivo carries the prose and the titles without personality-forward flourish; Plex Mono carries every number and label and is what makes the surface read as measured rather than styled.

### Hierarchy
The scale is exactly six steps; the prototype uses no others.
- **Display** (Archivo 700, 34px / `--text-xl`, line-height 1.05, -0.02em): Page titles and the score at display size.
- **Title** (Archivo 600, 24px / `--text-lg`, line-height ~1.15): Card and section titles.
- **Lead** (Archivo 400, 19px / `--text-base`): Lead copy directly under a title.
- **Body** (Archivo 400, 17px / `--text-sm`): Body and captions; keep measure around 50–65ch.
- **Meta** (IBM Plex Mono 400, 15px / `--text-xs`, tabular): Mono values and meta.
- **Label** (IBM Plex Mono 500, 13px / `--text-2xs`, 0.06em, often uppercase): Column heads, unit labels, status tags, sidebar group labels.

### Named Rules
**The Tabular Number Rule.** Every number is monospace and `font-variant-numeric: tabular-nums slashed-zero`. Aligned digits are the single detail that makes the product read as a tool.

**The Uppercase Budget.** Uppercase appears only on column heads and group labels (via `data-lab`, 0.06em). Never uppercase a heading, a button, or body copy.

## Layout

A two-plane model: a raised rail or panel against the ground, separated by tone and a hairline rule rather than a shadow. Content sits on a generous, quiet grid with real whitespace; density comes from the type scale and mono alignment, not from cramming. Spacing follows a 4pt rhythm (common steps 8 / 12 / 16 / 24px). The first-run flow is the canonical full-bleed two-column: a fixed left aside (brand, standing line, step nav, escape hatch) against a single working column on the right. Wide content (tables, code, stat rows) scrolls inside its own container; the page body never scrolls sideways.

## Elevation & Depth

Flat by default. The dark theme uses **no shadows at all** — planes are separated by tonal steps (ground → card → popover) and hairline borders. The one exception is the light theme, where a single soft elevation (`--elev: 0 2px 14px rgba(23,21,15,0.16)`) is permitted, because a flat surface on a paper ground needs one edge to sit on.

### Named Rules
**The Flat Console Rule.** Depth is tonal, not cast. Reach for a lighter surface and a hairline before you reach for a shadow; on dark, never reach for a shadow at all.

## Shapes

Square corners everywhere — every card, input, well, panel, and badge sits at `--radius: 0`. The single rounded form in the entire product is the **button**, a full pill (`rounded-full`). That contrast is the point: roundness marks the one place you act. Borders are single hairlines in one of two weights; there is no bevel, no gradient, no clipping trickery.

## Components

### Buttons
- **Shape:** Full pill (`rounded-full`), 32px tall at default size, compact horizontal padding (~10px).
- **Primary:** Amber fill, near-black text (`bg-primary text-primary-foreground`). At most one per screen — see The Amber Law.
- **Hover / Focus:** Primary darkens to `primary/80`; focus shows a 3px amber ring (`ring-ring/50`) instantly, never animated. Active nudges down 1px (`translate-y-px`) plus a global `brightness(0.9)` on press.
- **Secondary / Outline / Ghost:** All neutral. Secondary is a raised surface; outline is a hairline on ground; ghost is bare until a muted hover fill. These carry every non-primary action so amber stays rare.
- **Destructive:** A red wash (`destructive/10`) with red text, not a red fill — failure is stated, not shouted.

### Cards / Containers
- **Corner Style:** Square (0px).
- **Background:** Raised Card (#141416 / #eae7e1), one tonal step above ground.
- **Shadow Strategy:** None on dark; the single light-theme elevation only where a panel must lift off paper. See Elevation & Depth.
- **Border:** Hairline (#1f1f23 / #dcd8d0), or Strong Line for a heavier division.
- **Internal Padding:** 16px default (md).

### Inputs / Fields
- **Style:** Square, Strong Line stroke on ground.
- **Focus:** Amber border shift plus a soft amber ring — the same focus language as buttons, shown instantly.
- **Error / Disabled:** Error text and border in Failure Red; disabled drops to 50% opacity.

### Navigation
- **Style:** Left-rail and sidebar labels in muted ink; group labels uppercase mono. Active state is a raised neutral surface or an ink-weight shift — never amber (The Amber Law).

### Signature: The Score Readout
The one place amber is native. A post's score sits on `amber-wash` with an `amber-line` edge, set at display size in the same amber as the primary action, so "beat the median" and "the thing to do" share exactly one color across the whole product.

## Do's and Don'ts

### Do:
- **Do** keep amber for the score and one primary action per screen; carry everything else on neutral surfaces.
- **Do** set every number in IBM Plex Mono with tabular, slashed-zero figures.
- **Do** keep surfaces square (0px) and let the pill button be the only rounded form.
- **Do** separate planes with tone and a hairline; on dark, use no shadow.
- **Do** reserve uppercase for column heads and group labels, at 0.06em.

### Don't:
- **Don't** put amber on nav-active state, toggles, secondary buttons, the logo, progress bars, or count badges.
- **Don't** introduce a third chromatic hue, or a green loud enough to rival amber.
- **Don't** round card, input, or panel corners, and don't wrap surfaces in shadows on the dark theme.
- **Don't** set numbers in a proportional font or drop tabular figures.
- **Don't** invent metrics, counts, or states the app cannot actually produce — a capability the app lacks does not appear in the UI.
