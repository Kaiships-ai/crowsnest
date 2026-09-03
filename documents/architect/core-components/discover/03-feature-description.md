# discover: feature description

`documents/architect/core-components/discover/`

Status: the discover page is shipped and reachable from the nav. The seed picker drop-in is
built but not mounted anywhere yet.

Discover is a curated directory of Instagram creators to follow. A fixed list of real
handles, one file per niche, is loaded into a `creator_seeds` table at install time. The
page at `/channels/discover` groups them under niche tabs and lets a user follow any of them
with one click, which adds the handle as a tracked channel and queues a sync for it through
the same path a manual "Add channel" already uses. A second, unmounted component offers the
same list as a capped multi-select for a future first-run step.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | The discover page | Curated, niche-grouped creator cards with a one-click Follow | ● | `src/app/(shell)/channels/discover/page.tsx`, `src/components/discover/discover-board.tsx` | DISC-01, DISC-02 |
| 3 | The seed picker | Capped multi-select variant of the same seed list, for a future first-run step | ◐ | `src/components/discover/seed-picker.tsx` | DISC-03 |

## 2. The discover page

### Who uses it

Any user, especially a first-time buyer with no tracked channels yet, looking for creators
worth watching.

### What it does

`/channels/discover` opens on a grid of curated creator cards. Above the grid sit niche
tabs, All, Fitness, Finance, Tech, Business, that filter which cards show. Each card has the
handle, a niche badge, a one-line reason the creator is worth following, and a Follow
button.

### How to access it

The "Discover" entry in the sidebar nav (Sources group, Compass icon), or directly at
`/channels/discover`.

### Business rules

- The niche tabs filter the already-fetched list in memory; switching tabs never triggers a new server read.
- Follow disables itself immediately on click, reads "Queuing…" while the follow runs, then "Tracked" and stays disabled; a card can be followed at most once per page load.
- A seed whose handle already has a live tracked channel renders with Follow disabled and reading "Tracked" from first paint, with no click needed.
- Following reuses the exact add-channel and start-sync path a manual "Add channel" click uses. On success it inserts (or revives a soft-deleted) `channels` row and queues a channel-scoped sync; if a sync is already running for something else, the follow still reports success with no sync queued rather than failing.
- An invalid handle fails the follow with a toast naming the reason and returns the button to its idle "Follow" state rather than leaving it stuck on "Queuing…".
- With no rows in `creator_seeds` (the bootstrap step never run), the page shows a message pointing at `npm run db:bootstrap` instead of an empty grid.
- A niche tab with no matching seeds shows "No creators in this niche" rather than an empty grid.
- Cards never show a follower count, view count, or any other metric; the only thing sold on the card is the handle, the niche, and the curated `why` text.

### Limitations

- Suggestion ranking (a persona match or a similar-outlier signal) is not built. Every niche shows its full curated list in the query's fixed order, niche then handle alphabetically, with no personalization. See `DISC-01` in the [backlog](05-backlog-to-enhance.md).
- A creator seed is filed under exactly one niche. A creator whose content genuinely spans two niches (for example fitness and business) shows once, under its curated niche only. See `DISC-02` in the [backlog](05-backlog-to-enhance.md).

### User guide

Open Discover from the sidebar to browse a curated list of creators worth following, sorted
into niches: Fitness, Finance, Tech, Business. Each card explains in one line why that
creator made the list, no follower counts, just the reason. Click Follow on any card to
start tracking that creator; it queues a sync the same way adding a channel by hand does, so
the creator's posts begin appearing once the sync finishes. A creator you already follow
shows "Tracked" instead of a Follow button.

## 3. The seed picker

### Who uses it

Intended for a first-run buyer picking their first channels to track, once a future
first-run step mounts it. Nobody can reach it in the shipped app today.

### What it does

`SeedPicker` renders the same curated seeds under the same niche tabs, but as checkbox rows
instead of cards, capped at a configurable number of selections (10 by default), with one
"Follow selected" button that follows every checked handle.

### How to access it

Not reachable from any route in the shipped app. It is a self-contained component
(`src/components/discover/seed-picker.tsx`) with no import site outside its own test file.
It is built to be mounted directly by a future first-run "sources" step.

### Business rules

- Selecting is capped at `maxSelect` (10 by default): once at the cap, every unchecked row disables rather than letting a new pick silently bump an already-selected one off.
- An already-tracked seed's row is disabled and cannot be selected, whether or not the cap has been reached.
- "Follow selected" calls the same `followCreatorAction` the discover page's cards call, once per selected handle, in sequence; the batch is capped again defensively at `maxSelect` even though selection is already capped.
- A handle whose follow call fails is silently dropped from the resulting channel-id list rather than blocking or flagging the rest of the batch.
- After the batch finishes, the selection clears and the optional `onDone` callback receives only the channel ids that actually succeeded.

### Limitations

- Not mounted anywhere; there is no way to reach it by clicking through the shipped app today. Wiring it into a first-run step is deferred. See `DISC-03` in the [backlog](05-backlog-to-enhance.md).
- A partial batch failure (some handles follow, others don't) has no visible per-row error state in the component itself; the caller only learns which ids landed, through `onDone`.

### User guide

Not applicable yet; this component has no reachable entry point in the current app.

## 4. Interactions with other systems

Channels and sync. Discover's only durable write is the same one a manual channel add
produces: a `channels` row and a queued sync job. It has no write path of its own for
anything else, no draft state, and no autosave.

Feed and every other channel-reading surface. Discover writes nothing they read directly; a
newly followed creator becomes visible to the feed, the channels board, and the dashboard
only once its queued sync has actually run.

Background jobs and the sidecar. Follow's sync queue is the same `startSyncAction` the rest
of the app uses; it is owned in full by [background jobs](../../shared/background-jobs.md).
A sidecar that is down or falling behind never blocks discover's own render or follow click,
it only delays when the followed creator's posts actually arrive.

Status and failures. Discover has no failure strip surface of its own. A failed follow shows
as an inline toast on the card that attempted it, and an empty `creator_seeds` table shows
its own recovery message pointing at the bootstrap command, rather than the shell's shared
failure strip. See [status and failures](../../shared/status-and-failures.md).

Configuration and curation. The curated seed list itself is not a runtime setting; it is
content committed under `data/seeds/` and loaded once at `npm run db:bootstrap`. Changing
who appears on the list, or which niche a creator is filed under, means editing that JSON
and re-running bootstrap, not a setting a user can change from the UI.

## 5. Edge cases

- **Bootstrap never run.** An empty `creator_seeds` table shows a message pointing at `npm run db:bootstrap` on every niche tab, rather than a bare empty grid with no explanation.
- **A soft-deleted channel with a seed's handle.** The seed still shows, marked untracked; `listCreatorSeeds`'s join predicate carries the `deletedAt IS NULL` check itself rather than excluding the seed row with a `WHERE` clause, so re-removing and re-following the same handle behaves the same as following it for the first time.
- **A sync already running when Follow is clicked.** The follow still succeeds and the channel is still added; only the queued sync is skipped, reported back as `syncQueued: false` rather than as an error.
- **A creator seed filed under one niche only.** A dual-niche creator is not duplicated across tabs; they appear once, under whichever niche the curated file placed them in.
