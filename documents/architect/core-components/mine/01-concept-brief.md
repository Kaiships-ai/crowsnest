# mine: concept brief

`documents/architect/core-components/mine/`

Status: shipped. The planner, the publish dialog, manual and scheduled Graph measurement, per-reel insights, and account-wide audience live on the Dashboard as the My reels and Calendar tabs. The scheduled cadence and the newer reel metrics are unverified against a live Graph call (the configured token is rejected). There is no UI control to clear the own channel once set.

## 1. What it is

mine is the user's own side of crowsnest: how their own Instagram account is doing, and what they mean to post next. It lives on the Dashboard at `/` as two of its three tabs, held in the URL as `?tab=overview|reels|calendar`. Overview stays the research dashboard, owned by the dashboard component. My reels shows the own-account summary (followers, reach, saves, shares, median reach, posts measured), a reel picker, one reel's insights modeled on the Instagram app's Reel insights screen, that reel's views over time against the user's typical reel, and account-wide audience. Calendar is the planner: the month grid, the plan dialog, and the publish dialog that uploads a video, writes a caption, and publishes now or on a schedule. The old `/mine` route redirects to the Calendar tab and leaves the sidebar.

Own posts are read-only in mine. The only writer of `own_account_snapshots`, `own_posts`, `own_post_insights`, and `own_comments` is a Graph measurement; the instagrapi sidecar that fills the feed never touches these tables.

## 2. Why it exists

The rest of crowsnest studies other people's channels. mine is the one place turned inward: it answers "how is my own account doing, and what am I posting next". It reads real published performance through the official Instagram Graph API, a separate identity and code path from the sidecar ig-sync uses, and keeps a lightweight, honest plan of what to publish.

The rework exists because the Instagram app shows rich per-reel insights the old page never did (views, watch time, skip rate, per-viewer rates, actions after viewing), and because a views-over-time curve needs frequent measurements in a reel's first days, which only a background job can take. Putting both halves on the Dashboard puts "how am I doing" and "what next" one click from the daily landing page.

The planner and the metrics still do not need each other. Planned posts need no Graph connection, so the Calendar tab works with no token, while My reels gates on a real measurement.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Own channel | The one tracked channel flagged `channels.isOwn`, at most one row by the partial unique index `channels_single_own`. Set by `setOwnChannelAction`. |
| Graph API measurement | One run that reads the account, the media list, and each post's insights from `graph.instagram.com`, and writes the own-channel tables. Reach, saves, and shares here never mix with a tracked channel's view count. |
| Insight snapshot | One `own_post_insights` row per post per measurement, append-only. The latest row is the post's current numbers; all rows together are its views over time. |
| Scheduled measurement | An in-process job (`own-measure-scheduler.ts`), modeled on the sync and publish schedulers, that measures reels hourly for their first 72 hours and daily after, under Instagram's 200 calls per hour limit. |
| Typical reel | The median views, at the same whole hours since posting, across the user's other measured reels. Computed on the server in a pure function. |
| Per-viewer rate | Share, like, save, repost, or comment count divided by `reach`. Shown as a dash when reach is missing or zero. |
| Account-wide audience | Followers vs non-followers and age, country, gender breakdowns. The API gives these only for the whole account, so they are labelled as such, never as a reel's numbers. |
| Planned post | A dated intention to publish in `planned_posts`, optionally carrying a script, a video kind, a source video, or a remix session. Stored `state` is `draft`, `scheduled`, `publishing`, `published`, or `failed`; `missed` is derived on read. |
| Reconciliation | A suggestion, not a write: a not-yet-published plan sharing its date with an own post is offered to be marked published against it. |
| The two gates | The own channel flag and the Graph token are checked independently. Neither is faked: no own channel shows a picker, and a missing or failing token shows a connect panel, stacked over real historical numbers when there are any. |

## 4. How it fits in the system

mine's two tabs sit on the Dashboard route, which the dashboard component owns; the Dashboard page picks the tab from `?tab=` and runs only that tab's reads. mine reads the own channel flag and follower count from `channels` (owned by the channels board and ig-sync), reads scripts from the vault for the plan dialog, and reads the `scoreMinUsablePosts` setting for the median floor. It owns `planned_posts`, which the [publish](../publish/01-concept-brief.md) component also advances through its publish states. It owns the own-channel table set, `own_account_breakdowns` included, and the one measurement service (`src/server/services/own-measure.ts`) that writes it, whether a user clicks "Measure now" or the scheduler fires. The MCP server's `crowsnest_metrics` tool reads the own-channel queries.

## 5. Dependency map

### Upstream (what mine depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | `planned_posts`, `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`, `own_account_breakdowns`, `app_settings` for stored fetch errors, and a read of `channels`. |
| App settings (`scoreMinUsablePosts`, default 5) | The floor below which median reach stays null, shared with channel-side scoring. |
| The vault (`src/server/queries/vault.ts`, `getScripts`) | Read-only, for the plan dialog's script select. |
| The channels board and ig-sync (`src/server/queries/channels.ts`, `src/server/actions/channel-actions.ts`) | `getOwnChannel` and `getChannelsList` for the gate and picker; `setOwnChannelAction` for the flag. |
| The dashboard (`src/app/(shell)/(loaded)/page.tsx`) | Host of the My reels and Calendar tabs and the tab strip. |
| Secrets store (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`) | Read by the Graph client alone; Settings > API keys wins over `.env.local`. |
| `server.ts` | Boot point of the measurement scheduler, beside the sync and publish schedulers. |

### Downstream (what depends on mine)

| Consumer | What it reads |
| --- | --- |
| [publish](../publish/01-concept-brief.md) | The plan's `planned_posts` row, which it advances from `scheduled` through `publishing` to `published` or `failed`. |
| MCP server (`crowsnest_metrics`) | `getOwnChannelOverview` and `getOwnPosts`. |
| The dashboard's Overview | `getPlannedPosts` for the content pipeline's planned count. |
| Remix finish step and vault script dialog | Link to `/mine`, which redirects to the Calendar tab. |

### External

| Dependency | Role |
| --- | --- |
| Instagram Graph API (`graph.instagram.com`, Instagram Login) | The one external service mine calls, through `src/server/graph/client.ts`: account, media, per-media insights, comments, and account-level insights. Data can lag up to 48 hours; the limit is 200 calls per hour per user. |
| recharts, through `src/components/ui/chart.tsx` | The views-over-time chart. |

## 6. Boundaries

mine owns the My reels and Calendar tab content, the two gates, the planner, the plan and publish dialogs, the own-post displays, and the own-channel measurement, manual and scheduled. It does not own the Dashboard route, the tab strip's Overview content, the publish pipeline behind the publish dialog, the remix flow, the vault, the ideas inbox, or the persona. Own posts are read-only here: the Graph measurement is their only writer. Marking a channel own is a single durable flag; there is no control to clear it (`unsetOwnChannelAction` exists but nothing calls it; tracked in the GitHub backlog (label `backlog`)).
