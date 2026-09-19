# Design system

crowsnest uses a stock shadcn/ui theme: the neutral base color, standard radius,
and shadcn's own chart palette. Tokens live in `src/app/globals.css`, primitives
under `src/components/ui/`, and feature components under `src/components/`. This page
is the playbook for changing UI without reaching for a generic design skill. Routine
fixes follow these rules; design skills are for a net-new surface with no precedent
here, not for keeping the house style.

The theme is the standard shadcn neutral palette (the `base-maia` style, Inter font,
orange chart ramp), so anything in the shadcn docs applies directly. One thing is kept
on top of stock shadcn and documented below: a single `success` status color. The type
scale is Tailwind's own, plus one extra step below `text-xs`.

The full shadcn component set is installed under `src/components/ui/`. The `/gallery`
route renders the shadcn `preview` showcase (the `base-maia` block ported into
`src/components/blocks/preview/`): ~30 real cards that compose the primitives together,
in light and dark, for eyeballing the system before using it.

## Color tokens

Use the semantic token, never a raw Tailwind color. All are defined in
`src/app/globals.css` and available as `bg-*`, `text-*`, `border-*`. Dark is the
default (`:root` holds the light values, the `.dark` class holds dark); next-themes
toggles the class.

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
| `chart-1..5` | Chart series. These are shadcn's amber-to-orange ramp. Use `chart-1..n` for both categorical series and magnitude ramps |
| `ring` | Focus rings (handled by the primitives) |
| `sidebar*` | Sidebar surfaces, handled by the sidebar components |

Status rule: one primary action and one success color per screen. Failure is
`destructive`. There is no separate warn color: a degraded state reads as muted text
or a `destructive` wash.

## Type scale

Tailwind's stock scale, because that is what the shadcn primitives are authored
against: `CardTitle` is `text-base`, `CardDescription`, `FieldDescription` and `Item`
are `text-sm`. Overriding the scale inflates every composition, so do not. One extra
step is defined as `--text-2xs` in `globals.css`, a notch below `text-xs`, for the
labels the stock scale has no size for.

| Class | Size | Role |
| --- | --- | --- |
| `text-2xs` | 11px | Mono labels, column heads, units (the workhorse) |
| `text-xs` | 12px | Mono values, meta |
| `text-sm` | 14px | Body, captions |
| `text-base` | 16px | Lead copy, card titles |
| `text-lg` | 18px | Section titles |
| `text-xl` | 20px | Page titles |

Labels, units, values, and timestamps are mono (`font-mono`). Numbers carry the
`.tabular` class or `data-num` so columns line up. Column heads and sidebar group
labels use `data-lab` for uppercase tracking. Prose is the sans body font.

## Which primitive for what

Check `src/components/ui/` before writing custom markup. Reach for a feature component
under `src/components/` before duplicating one. The shadcn skill
(`.claude/skills/shadcn/`) holds the full composition rules; these are the crowsnest
specifics.

| Need | Use | Not |
| --- | --- | --- |
| A whole panel or view with no data | `Empty` (`ui/empty.tsx`) | A hand-built centered div |
| One "no items yet" line inside a list or log | A single `text-sm text-muted-foreground` line | `Empty` (too heavy for an inline state) |
| A panel with a title, body and optional header action | `Card` + `CardHeader` / `CardTitle` / `CardAction` / `CardContent` / `CardFooter` | A `div` with `border border-border bg-card` |
| A labelled control with a hint or an error | `Field` + `FieldLabel` / `FieldDescription` / `FieldError`, grouped by `FieldGroup`, sectioned by `FieldSet` | A hand-stacked `Label` + control + `p` |
| A list row with media, title, description and an action | `ItemGroup` + `Item` / `ItemMedia` / `ItemContent` / `ItemTitle` / `ItemActions` | A `flex items-center justify-between` row |
| Rows and columns of data | `Table` (it brings its own scroll container) | A `grid grid-cols-[...]` pretending to be a table |
| An input with a leading icon, or an input plus a button | `InputGroup` + `InputGroupInput` / `InputGroupAddon` / `InputGroupButton` | A `relative` wrapper with an absolute icon and `pl-8` |
| Adjacent buttons forming a toolbar | `ButtonGroup` | Bare siblings with `gap-2` |
| Exclusive selection among options | `ToggleGroup` (this build takes `value` as an array) | Raw buttons with `aria-pressed` |
| The page gutter | `PageContainer` (`layout/page-container.tsx`) | A hand-written `mx-auto max-w-[1120px] p-6` |
| Inline loading indicator | `Spinner` (`ui/spinner.tsx`) | A raw `Loader2` with `animate-spin` |
| Content-shaped loading placeholder | `Skeleton` | A custom `animate-pulse` div |
| Status pill | `Badge` with a variant | A styled `span` |
| Vertical or horizontal spacing | `flex` + `gap-*` | `space-y-*` / `space-x-*` |
| Equal width and height | `size-*` | `w-* h-*` |

Take the primitives at their defaults. `Card` and `Item` are `rounded-2xl`,
`InputGroup` and `ButtonGroup` are `rounded-4xl`. Do not add a `className` to undo a
default for tone or radius; override only when a layout would otherwise break.

## Fixing UI without a design skill

1. Find the component under `src/components/<feature>/`.
2. Change layout with `className` (`flex`, `grid`, `gap-*`), never override a
   primitive's colors or typography.
3. Use the token or type-scale class for the role, from the tables above. It is a
   stock shadcn theme, so the shadcn docs and examples apply as written.
4. Run impact analysis before editing a shared primitive (see the GitNexus rules in
   `AGENTS.md`), then `npm run build && npm run test && npm run lint && npm run typecheck`.

Invoke a design skill only for a net-new surface with no precedent here, or a
deliberate redesign the team has agreed to. For everything else, this page plus the
existing components is the source of truth.
