---
name: Crowsnest
description: A calm, neutral instrument for creators, built on the stock shadcn base-maia theme with monospaced numbers.
colors:
  background: "oklch(0.145 0 0)"
  card: "oklch(0.205 0 0)"
  foreground: "oklch(0.985 0 0)"
  muted-foreground: "oklch(0.708 0 0)"
  secondary: "oklch(0.269 0 0)"
  border: "oklch(1 0 0 / 10%)"
  input: "oklch(1 0 0 / 15%)"
  ring: "oklch(0.556 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  success: "oklch(0.696 0.17 162)"
  destructive: "oklch(0.704 0.191 22.216)"
  chart-1: "oklch(0.837 0.128 66.29)"
  chart-2: "oklch(0.705 0.213 47.604)"
  chart-3: "oklch(0.646 0.222 41.116)"
  chart-4: "oklch(0.553 0.195 38.402)"
  chart-5: "oklch(0.47 0.157 37.304)"
typography:
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.06em"
  meta:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    fontFeature: "tabular-nums slashed-zero"
rounded:
  base: "0.625rem"
  card: "1rem"
  pill: "2rem"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
  surface-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design system: Crowsnest

crowsnest uses a stock shadcn/ui theme: the `base-maia` style, the neutral base color, the
standard radius, and shadcn's own chart palette. The frontmatter above is the dark theme,
which is the default, and the light values mirror it (themes: dark, light; no system mode).
The Next.js web app that carried these tokens and its components is deleted. Its screens move
into Lead Studio boards in the Electron app (`src/renderer/`), whose shadcn primitives live in
`src/renderer/src/components/ui/`; this page is the visual system those boards follow.

This page is the playbook for changing UI without reaching for a generic design skill. Routine
fixes follow these rules. Design skills are for a net-new surface with no precedent here, not
for keeping the house style. Anything in the shadcn docs applies directly.

## Character

Neutral and quiet. There is no brand hue: `primary` is a near-white (dark) or near-black
(light) neutral, surfaces separate by tonal steps, and the numbers carry the identity. Inter
carries words. IBM Plex Mono carries every number, id, timestamp, and system state, with
tabular, slashed-zero figures so columns line up. One status color, `success`, is kept on top
of stock shadcn. The rest of the chromatic range is the orange chart ramp and `destructive`.

## Color tokens

Use the semantic token, never a raw Tailwind color. They are the frontmatter values above,
used as `bg-*`, `text-*`, `border-*`.

| Token | Use for |
| --- | --- |
| `background`, `foreground` | Page ground and default text |
| `card`, `card-foreground` | Panel surfaces |
| `popover`, `popover-foreground` | Floating surfaces |
| `muted`, `muted-foreground` | Secondary surfaces and secondary text (also the quiet-label role) |
| `border`, `input` | Hairlines and control edges |
| `primary`, `primary-foreground` | The one primary action per screen, and value emphasis |
| `secondary`, `accent` | Raised and hover surfaces |
| `destructive` | Errors and failed states. Use `color-mix(in srgb, var(--destructive) 12%, transparent)` for a wash |
| `success`, `success-foreground` | The one "good" state (a metric up, a run succeeded). The only status color shadcn does not ship, kept for this |
| `chart-1..5` | Chart series, shadcn's amber-to-orange ramp. Use `chart-1..n` for both categorical series and magnitude ramps |
| `ring` | Focus rings (handled by the primitives) |
| `sidebar*` | Sidebar surfaces, handled by the sidebar components |

Status rule: one primary action and one success color per screen. Failure is `destructive`.
There is no separate warn color: a degraded state reads as muted text or a `destructive` wash.

## Type scale

Tailwind's stock scale, because that is what the shadcn primitives are authored against:
`CardTitle` is `text-base`, `CardDescription`, `FieldDescription` and `Item` are `text-sm`.
Overriding the scale inflates every composition, so do not. One extra step is defined as
`--text-2xs`, a notch below `text-xs`, for labels the stock scale has no size
for.

| Class | Size | Role |
| --- | --- | --- |
| `text-2xs` | 11px | Mono labels, column heads, units (the workhorse) |
| `text-xs` | 12px | Mono values, meta |
| `text-sm` | 14px | Body, captions |
| `text-base` | 16px | Lead copy, card titles |
| `text-lg` | 18px | Section titles |
| `text-xl` | 20px | Page titles |

Labels, units, values, and timestamps are mono (`font-mono`). Numbers carry the `.tabular`
class or `data-num` so columns line up. Column heads and sidebar group labels use `data-lab`
for uppercase tracking. Prose is the sans body font. Never uppercase a heading, a button, or
body copy.

## Shape, depth, and motion

The base radius is `0.625rem`. `Card` and `Item` are `rounded-2xl`, `Button` is `rounded-4xl`
(a pill), `InputGroup` and `ButtonGroup` are `rounded-4xl`. Cards separate from the ground by
tone plus a faint ring (`ring-foreground/10`), not a drop shadow. Focus is a 3px `ring`
shown instantly. Pressed buttons nudge down 1px. Sheets slide in and out on the drawer curve
(`--ease-drawer`, `cubic-bezier(0.32, 0.72, 0, 1)`, 200ms), transitioning only translate
and opacity; under reduced motion they fade without sliding. The one custom keyframe animation is the sidebar
new-outlier badge, which settles in once (`rail-signal-settle`) and appears plainly under
reduced motion.

## Which primitive for what

Check `src/renderer/src/components/ui/` before writing custom markup. Reach for an existing
feature component before duplicating one. The shadcn skill (`.claude/skills/shadcn/`) holds
the full composition rules; these are the crowsnest specifics.

| Need | Use | Not |
| --- | --- | --- |
| A whole panel or view with no data | `Empty` | A hand-built centered div |
| One "no items yet" line inside a list or log | A single `text-sm text-muted-foreground` line | `Empty` (too heavy for an inline state) |
| A panel with a title, body and optional header action | `Card` + `CardHeader` / `CardTitle` / `CardAction` / `CardContent` / `CardFooter` | A `div` with `border border-border bg-card` |
| A labelled control with a hint or an error | `Field` + `FieldLabel` / `FieldDescription` / `FieldError`, grouped by `FieldGroup`, sectioned by `FieldSet` | A hand-stacked `Label` + control + `p` |
| A list row with media, title, description and an action | `ItemGroup` + `Item` / `ItemMedia` / `ItemContent` / `ItemTitle` / `ItemActions` | A `flex items-center justify-between` row |
| Rows and columns of data | `Table` (it brings its own scroll container) | A `grid grid-cols-[...]` pretending to be a table |
| An input with a leading icon, or an input plus a button | `InputGroup` + `InputGroupInput` / `InputGroupAddon` / `InputGroupButton` | A `relative` wrapper with an absolute icon and `pl-8` |
| Adjacent buttons forming a toolbar | `ButtonGroup` | Bare siblings with `gap-2` |
| Exclusive selection among options | `ToggleGroup` (this build takes `value` as an array) | Raw buttons with `aria-pressed` |
| Inline loading indicator | `Spinner` | A raw `Loader2` with `animate-spin` |
| Content-shaped loading placeholder | `Skeleton` | A custom `animate-pulse` div |
| Status pill | `Badge` with a variant | A styled `span` |
| Vertical or horizontal spacing | `flex` + `gap-*` | `space-y-*` / `space-x-*` |
| Equal width and height | `size-*` | `w-* h-*` |

Take the primitives at their defaults. Do not add a `className` to undo a default for tone or
radius; override only when a layout would otherwise break.

Primitive behaviors that callers rely on:

| Case | What to write | Why |
| --- | --- | --- |
| A one-line `ItemTitle` that must ellipsize | `className="block truncate"` | `ItemTitle` is `display: flex`, which clips text but never draws the ellipsis. `ItemContent` is `min-w-0`, so the title can shrink. |
| A stack of `Card`s in a height-bounded scroller | `*:shrink-0` on the scroller | `Card` is `overflow-hidden`, which drops its flex minimum height to 0, so the cards shrink and clip instead of the list scrolling. |
| A `ToggleGroup` whose labels can outgrow a phone | `className="flex-wrap"` | `ToggleGroup` is single-line by default and clips past the edge. |

## Fixing UI without a design skill

1. Find the component under `src/renderer/src/components/`.
2. Change layout with `className` (`flex`, `grid`, `gap-*`), never override a primitive's
   colors or typography.
3. Use the token or type-scale class for the role, from the tables above.
4. Run impact analysis before editing a shared primitive (see the GitNexus rules in
   `AGENTS.md`), then `pnpm run build && pnpm test && pnpm run lint && pnpm run typecheck`.

Invoke a design skill only for a net-new surface with no precedent here, or a deliberate
redesign the team has agreed to.

## Do's and don'ts

- **Do** use semantic tokens, `text-2xs` mono labels, and `data-num` on numbers.
- **Do** keep one primary action and one success color per screen.
- **Do** compose from `src/renderer/src/components/ui/` primitives at their defaults.
- **Don't** reach for a raw Tailwind color or a shadow on a card.
- **Don't** set numbers in a proportional font or drop tabular figures.
- **Don't** invent metrics, counts, or states the app cannot produce. A capability the app
  lacks does not appear in the UI.

## Interaction model

Every action in the core loop passes through five phases, and a feature's docs narrate it in
those phases.

- **Arrive.** The view or dialog opens. What the user sees is a snapshot read when it opened.
- **Leave without acting.** The user backs out before changing anything. Usually nothing is
  recorded.
- **Begin acting.** The first edit or click that starts real work.
- **While acting.** What updates while work is in flight: a disabled trigger for an instant
  write.
- **Finish.** What is committed and where the user lands.

Four words are used the same way everywhere. **Commit** is the durable step: a row written, a
script saved, a plan created; until then, leaving discards the action. **Cancel** is the user
ending an action on purpose before it commits. **Stop** is ending an already running process,
which may already have side effects. **Interrupt** is anything the user did not do on purpose
that ends an action: a backing service failing, the target record changing underneath, a
reload, a second tab.

A write reaches the server through a server action (`src/server/actions/`), which returns
`{ ok: true, ... }` or `{ ok: false, error, code }` instead of throwing. The code lets a caller
tell "already saved" from "gone". While an action runs its trigger is disabled.

The app makes no model call. Text an agent writes over MCP lands in the same records the
boards read.

Edge cases: a record can change under an open view, and the action answers "no longer exists"
or "already done". The degradation contract (sidecar down, Graph token invalid, no own
channel) is in `PRODUCT.md`.

## Navigation and shell

The Next.js shell (sidebar, Nguồn and Cài đặt tabs, the Tuần này screen, redirects, the
first-run gate, the command menu) is deleted with the web app. The shell is now the Lead
Studio Electron app; see `documents/architecture/app.md`. The screens move into Lead Studio
boards. The server data and the MCP tools that fed the old screens are unchanged.
