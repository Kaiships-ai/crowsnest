# mine: concept brief

`documents/architect/core-components/mine/`

Status: shipped and in daily use. A plan edit's four-write sequence has no rollback, the delete undo is lossy, and there is no UI control to clear the own channel once set; none of these block the page from working, and each is tracked in the backlog.

## 1. What it is

mine is the my channel page at `/mine`, the one screen for the user's own Instagram channel, as opposed to the tracked competitors that fill the feed. It shows a header naming which channel is theirs, a band of metrics measured through the official Instagram Graph API (followers, reach, saves, shares, median reach, posts measured) with a progress bar toward a usable median, a reach-by-post strip, and a tab strip that switches between a Month planner calendar, a Posts list, and a weekday Metrics chart. Below the metrics it owns the planner: a seven-column month grid of planned and published days, and the plan dialog that creates or edits a planned post, a dated intention to publish, optionally carrying a script. Every planned post can be opened in the studio to cook it, at `/mine/{postId}/studio`.

Own posts are read-only on this page. The only writer of `own_posts`, `own_post_insights`, and `own_account_snapshots` is a Graph measurement (`measureOwnChannelAction`); the instagrapi sidecar that fills the feed never touches these tables, so a tracked-channel sync never changes anything this page shows.

## 2. Why it exists

The rest of crowsnest is about other people's channels, analyzing competitor reels and mining outliers. mine is the one place turned inward: it answers "how is my own account doing, and what am I planning to post". It exists so the user can see their real published performance, measured through the official Graph API, a separate identity and code path from the instagrapi sidecar that ig-sync uses to study other creators, and keep a lightweight, honest plan of what to publish, with no auto-publish machinery. A planned post is inert: nothing here publishes or reminds; a plan becomes published only when the user marks it so by hand.

The planner and the metrics deliberately do not need each other. Planned posts need no Graph connection, so the calendar renders even on a machine with no Graph token configured, while the metrics band gates on a real measurement.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Own channel | The one tracked channel flagged `channels.isOwn`, enforced to at most one row by the partial unique index `channels_single_own`. Set by `setOwnChannelAction`, cleared by `unsetOwnChannelAction`, though nothing in this page's UI calls the clear action. |
| Graph API measurement | The official Instagram Graph API reads mine's data, kept in a separate table set (`own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`) from the tracked-channel tables ig-sync writes. Reach, saves, and shares here are a different quantity from a tracked channel's view count and are never mixed with it. |
| Planned post | A dated intention to publish, stored in `planned_posts`, optionally carrying a script, a video kind, a source video, or a remix session. The stored `state` is only ever `draft`, `scheduled`, or `published`; there is no code path that stores `missed`. |
| Missed, derived on read | `getPlannedPosts` and `getCalendarMonth` compute `missed` on every read by comparing today against a `scheduled` plan's `plannedDate`. A reschedule cannot leave a stale missed cell behind, because nothing was ever stored to begin with. |
| Reconciliation | A suggestion, not a write: when a dated, not-yet-published plan shares its date with an own post, the read computes `reconciledOwnPostId` and the calendar offers to mark the plan published against it. Nothing marks it automatically. |
| The two gates | The own channel flag and the Graph token are checked independently. Neither is faked when its data is missing: no own channel renders a picker instead of the page, and a token that is missing or failing renders a connect panel where the metrics would be. |
| The edit sequence | There is no single patch action for a planned post. Saving an edit calls up to four separate server actions in a fixed order (title and note, then date, then script, then video kind), each fired only if that field changed, with no rollback across the sequence. |

## 4. How it fits in the system

mine sits at `/mine` in the shell, reached from the sidebar. It reads the own channel flag and the tracked channel's follower count from `channels` (owned by the channels board and ig-sync), reads scripts from the vault to offer in the plan dialog, and reads the `scoreMinUsablePosts` setting to place the progress bar and gate the median. It owns `planned_posts` outright, and is the only page that writes it outside of the studio's own publish step. It owns the entire own-channel table set (`own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`) together with the Graph actions that measure them; nothing else in crowsnest reads or writes those tables.

Clicking a planned post open in the studio hands off to a separate component ([studio](../studio/01-concept-brief.md)) that reads the plan through `getStudioBrief` and can, on publish, write back to the same `planned_posts` row. The persona at `/persona` and the ideas inbox at `/ideas` are separate routes and components that neither read from nor write to anything on this page.

## 5. Dependency map

### Upstream (what mine depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | Every table mine reads and writes: `planned_posts`, `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`, plus a read of `channels` for the own-channel flag and follower count. |
| App settings (`scoreMinUsablePosts`, DB over env over default, default 5) | The progress bar's target and the floor below which the median reach and own-channel scoring both stay null. Shared with the channel-side outlier baseline, not a separate copy. |
| The vault (`src/server/queries/vault.ts`, `getScripts`) | Read-only, to populate the plan dialog's script select. |
| The channels board and ig-sync (`src/server/queries/channels.ts`, `src/server/actions/channel-actions.ts`) | `getOwnChannel` and `getChannelsList` for the gate and the picker's candidate list; `setOwnChannelAction`/`unsetOwnChannelAction` for the own-channel flag itself. |
| `.env.local` credentials (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`) | Read by the Graph client (`src/server/graph/client.ts`) alone; a missing or invalid value is what the connect panel's gate is checking. |

### Downstream (what depends on mine)

| Consumer | What it reads |
| --- | --- |
| studio (`/mine/{postId}/studio`) | One `planned_posts` row through `getStudioBrief`, to cook that plan and, on publish, mark it published. |
| Shell nav (topbar `ROUTE_TITLES`) | Renders the route's title "My channel"; the page's own header names which channel is theirs, one heading level below it. |

### External

| Dependency | Role |
| --- | --- |
| Instagram Graph API | The one external service this page calls, through `src/server/graph/client.ts`, for the account, its posts and their insights, and comments. A separate, official, token-authenticated path, never the instagrapi sidecar ig-sync uses to study other creators. |

## 6. Boundaries

mine owns the my channel page frame, the two gates that decide what it can show, the planner calendar, the plan dialog, and the read-only own-post and metrics displays. It does not own the studio (the `[postId]/studio` route hands off to the [studio](../studio/01-concept-brief.md) component) or the remix flow that produces a script. It does not own the vault at `/vault` (saved posts, scripts, hook and style templates), the ideas inbox at `/ideas`, or the persona at `/persona`, each a separate route and component; mine only reads the vault's scripts to offer them in the plan dialog. Own posts are read-only here: the only writer is a Graph measurement (`measureOwnChannelAction`); the instagrapi sidecar writes tracked videos, never own posts, so a tracked-channel sync never changes this page. Marking a channel own is a single durable flag (`channels.isOwn`); there is no control on this page to clear it (`unsetOwnChannelAction` exists but the page never calls it, tracked as B-15 in [05-backlog-to-enhance](05-backlog-to-enhance.md)).
