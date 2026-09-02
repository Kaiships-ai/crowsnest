# Crowsnest UI integration, target ~80% match to the Claude Design prototype

Written 2026-07-30. Supersedes the "still open" items in `docs/design/from-claude-design/RECONCILED.md`.

## What this is

`docs/design/from-claude-design/RECONCILED.md` already applied the design system's foundation: color tokens, fonts (Archivo, IBM Plex Mono), and pill-radius buttons in `globals.css`, `layout.tsx`, and `button.tsx`. That work is done and uncommitted on this branch.

This spec covers the next layer: making each real screen look like its counterpart in the prototype (`Crowsnest UI Mockups/Crowsnest Prototype.dc.html`, identical to `docs/design/from-claude-design/Crowsnest-Prototype.dc.html` except for comment-tool annotations). Target fidelity is around 80% visual match per screen: layout, spacing, card shapes, row density, hierarchy, badge and empty-state treatment. Not a pixel-for-pixel port of the prototype's markup, since the prototype is static vanilla CSS with fabricated data and this app is Tailwind v4 plus shadcn components wired to real queries and server actions.

Kai's rule from `RECONCILED.md` carries forward: where the prototype and any written doc disagree, the prototype wins.

## Screen map

Prototype screen (`data-screen=` value, line in the .dc.html) to real route:

| Prototype screen | Line | Real route | Key components |
|---|---|---|---|
| `dashboard` | 386 | `src/app/(shell)/page.tsx` | stat-tile, sparkline, outlier-scroll-row, fleet-spike-row |
| `feed` | 520 | `src/app/(shell)/feed/page.tsx` | feed-grid, outlier-card, filter-bar, outlier-badge, video-thumb |
| `detail` | 628 | `src/app/(shell)/feed/[videoId]/page.tsx` | video-detail, video-player, metric-chips, carousel-viewer |
| `remix` | 761 | `src/app/(shell)/feed/[videoId]/remix/page.tsx` | stepper, stage-prompt/research/hook/style/script, context-rail |
| `channels` | 870 | `src/app/(shell)/channels/page.tsx` | channel-table, fleet-rail |
| `mine` (my channel) | 904 | `src/app/(shell)/channels/[channelId]/page.tsx` | channel-header, outlier-history-chart, channel-video-grid |
| `vault` | 1100 | `src/app/(shell)/vault/page.tsx` | template-card, script-card |
| `settings` | 1149 | `src/app/(shell)/settings/page.tsx` | api-key-status-card, instagram-section, local-binaries-section, niche-profile-section, sync-section |

The prototype's `auth`/`welcome`/`signin`/`focus`/`connect`/`sources`/`firstsync` screens (lines 74 to 311) are onboarding, out of scope: this app has no signup flow (per `UI-BRIEF.md`, "no signup, no onboarding").

## Method, per screen

For each screen, in the order above:

1. Read the prototype's screen section directly from the `.dc.html` (line range from the map, extended to the matching closing tag).
2. Read the real page and every component it renders.
3. Rebuild the component's Tailwind classes and JSX structure to match the prototype's layout, spacing, type scale, and card treatment, using the existing shadcn primitives in `src/components/ui` wherever one fits (never hand-roll a primitive that already exists).
4. Numeric specifics not already fixed in `RECONCILED.md` (table row height, card padding, gap sizes) get read straight from the prototype's inline styles for that specific instance. No global override number invented to be "consistent" if the prototype itself varies.
5. Real data, queries, server actions, and existing prop contracts are untouched. This is a rendering-layer change only.
6. Existing tests must still pass. Update an assertion only where it checks a literal string that the rename step (below) changes.
7. Commit after each screen.

## Vocabulary rename

Sequenced as its own commit per screen area, immediately after that screen's visual pass lands (not batched at the end, not deferred to a separate future project).

Renames, prototype and Kai's law doc vs current codebase:

- "sidecar" to "local service" (instagrapi python process)
- "Tracked channel" / "Owned channel" (CONTEXT.md terms) to whatever the prototype's own copy says on screen, checked per screen at rename time since the prototype doesn't use "Tracked"/"Owned" as user-facing labels, it uses "My channel" for the owned one and channel name elsewhere
- "multiplier" or "outlier score" language, where it appears as user-facing copy, to "score" (prototype's `p-score`/`{{ o.markScale }}` scoring language, confirmed in `RECONCILED.md`'s amber section: "the score is views divided by the channel's own baseline")

CONTEXT.md's glossary gets updated to match once the renames are in, since it is supposed to be the vocabulary source of truth.

## Light theme

`globals.css` currently carries a dormant `[data-theme="light"]` block from the prototype that nothing toggles (per `RECONCILED.md`, "Applied" section). `UI-BRIEF.md` locks the product as dark only. That block gets deleted in the first commit of this work (before the feed screen pass), since dead CSS for a banned mode is only noise.

## Out of scope

- No new features or screens beyond what already exists.
- No changes to data flow, query shape, or server actions.
- No changes to the sync engine, LLM client, or any `src/server` module beyond string literals touched by the rename.
- The prototype's onboarding flow (`welcome`/`signin`/`focus`/`connect`/`sources`/`firstsync`), since this app has none.

## Verification

- `npm run build` and `npm test` pass after each screen's commit.
- Manual check in the browser (dev server) for each screen once its pass lands, comparing side by side against the prototype's rendered screen, before moving to the next.
