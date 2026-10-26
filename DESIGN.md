---
name: Lead Studio
description: Lead Studio is Orca's design system. Tokens in src/renderer/src/assets/main.css, primitives in src/renderer/src/components/ui/, rules in docs/STYLEGUIDE.md; this page adds only what boards need.
colors:
  background: "#fff"
  foreground: "#0a0a0a"
  card: "#fff"
  muted: "#f5f5f5"
  muted-foreground: "#737373"
  border: "#e5e5e5"
  primary: "#171717"
  primary-foreground: "#fafafa"
  destructive: "#e40014"
  status-success: "#15803d"
  status-warning: "#ca8a04"
  git-decoration-modified: "#895503"
typography:
  sans: "Geist (var(--font-sans))"
  mono: "var(--font-mono)"
rounded:
  base: "0.625rem"
---

# Design system: Lead Studio

Lead Studio is Orca with Lead Studio's boards on top, so its visual system is Orca's. The
source of truth is code, not this page:

- Tokens: `src/renderer/src/assets/main.css` (`:root` for light, `.dark` for dark). The
  frontmatter above copies a few light values for reference only.
- Primitives: `src/renderer/src/components/ui/` (Button, Badge, Card, Dialog, Input, Label,
  Switch, Tooltip, ToggleGroup, Tabs, DropdownMenu, Sheet, and the rest in that folder).
- Rules: `docs/STYLEGUIDE.md` (color roles, type, radius, elevation, which primitive for what,
  UX rules). Read it before any UI change.

The proto and the proposal wireframes give
structure and flow only, never colors, fonts or spacing. Copy is English through `translate()`
keys; the `en` catalogs hold the English text.

## Tokens Lead Studio uses

Use the semantic token for the role, never a raw Tailwind color or a hex value.

| Token | Use for |
| --- | --- |
| `background`, `foreground` | Board ground and default text |
| `card`, `border` | A tile or panel: `rounded-lg border border-border bg-card` |
| `muted`, `muted-foreground` | Secondary text, labels, empty bars, a number that is not whole |
| `primary`, `primary-foreground` | The one primary action on a screen (Approve, Connect) |
| `destructive` | A failed pull or a failed action |
| `status-success` (`-background`, `-border`) | A connected source, a verified check, an add in Gate 1 |
| `status-warning` (`-background`, `-border`) | A partial number (missing N keywords), a partial pull, an edit in Gate 1 |
| `worktree-sidebar*` | The left sidebar rows, as Orca draws them |
| `diff-added-ground`, `diff-removed-ground` | Monaco diff lines, set by Orca |

Lead Studio adds one token, because Orca had no "edited line" color: `--diff-modified-ground`
(`--git-decoration-modified` at 22% in light, 26% in dark), applied by the
`.lead-diff-modified-line` class to the lines Gate 1 marks as edited. Add a token only when no
Orca token fits the role, and name it in this section.

Source states use Orca's Integrations tones (`IntegrationStatusPill`, `IntegrationCardShell`):
Connected is the connected tone; Not configured, Error and Partial are the attention tone.

## Type

Geist for words (`font-sans`), `var(--font-mono)` for numbers, ids, times and source tags.
Tailwind's scale plus Orca's `text-2xs` (11px) and `text-3xs` (10px). Every number carries
`data-num` and `tabular-nums`. Board titles are `text-xl font-medium`, block titles
`text-sm font-medium`, tile labels `text-xs text-muted-foreground`.

## Board kit

Boards compose `src/renderer/src/components/board/kit/` before writing markup:

| Need | Use |
| --- | --- |
| A number with its data state | `KpiValue`, or `KpiTile` for a bordered tile with a label |
| Where a block's numbers come from | `BlockHeader` with one `SourceTag` (sources and the oldest pull time, once per block) |
| A connector's state | `StatePill` (`SOURCE_STATE`) |
| A funnel step's size | `Bar` (log scale) |
| Rows and columns of data | `DataTable` |
| Loading, empty and error | `BoardStates` with `useBoardLoad` |

A number is in one of five states and the slot keeps its size in all of them: a value; a
partial total (muted, badge "missing N keywords"); not connected (an em dash, badge
"<source> not connected" that opens Settings > Sources); a failed or partial newest pull (the
older number muted, badge "<source> pull failed"); no data yet (an em dash). A gap never reads
0.

## Fixing UI

1. Find the component under `src/renderer/src/components/`.
2. Change layout with `className` (`flex`, `grid`, `gap-*`); take primitives at their defaults.
3. Pick the token and type class for the role from the tables above and `docs/STYLEGUIDE.md`.
4. Run impact analysis before editing a shared primitive (GitNexus rules in `AGENTS.md`).
5. Prove it in the app with the verify skill. A UI PR diffs its screens against the v2
   baseline (`.claude/skills/verify/features/baseline.md`).

## Do's and don'ts

- **Do** reuse an Orca component before building one (Integrations cards for Sources, `DiffViewer` for Gate 1).
- **Do** name each block's source and pull time once, and mark every number that is not whole.
- **Do** keep one primary action per screen.
- **Don't** invent a color, font size or shadow tier; add a token only as above.
- **Don't** put Vietnamese or any copy outside `translate()`.
- **Don't** show a capability the app lacks.

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

The shell is Orca's: left sidebar, tab bar, split panes, right sidebar, status bar. Lead
Studio's rows sit under Search (Today; Insight: Funnel, My channel, Rivals; Create: Plan,
Studio; System: Sources, Agents), with Orca's workspace list below titled Workspaces.
Settings lists only the creator panes. What is hidden and where: `documents/architecture/app.md`.
