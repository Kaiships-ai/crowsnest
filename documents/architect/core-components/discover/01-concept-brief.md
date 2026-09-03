# discover: concept brief

`documents/architect/core-components/discover/`

Status: the discover page is shipped and reachable from the nav. The seed picker drop-in is
built but not mounted anywhere yet.

## 1. What it is

Discover is a curated directory of Instagram creators to follow, at `/channels/discover`
(`src/app/(shell)/channels/discover/page.tsx`). A fixed list of real Instagram handles, one
JSON file per niche under `data/seeds/`, is loaded into a `creator_seeds` table by
`npm run db:bootstrap`. The page reads every seed, groups them under niche tabs (All,
Fitness, Finance, Tech, Business), and shows one card per creator: the handle, a niche
badge, and a one-line reason the creator is worth following. Each card's Follow button adds
that handle as a tracked channel and queues a sync for it, reusing the exact add-channel and
start-sync path a manual "Add channel" already uses, not a second write pipeline.

A second component, `SeedPicker`, offers the same curated seeds as a capped multi-select
(checkbox rows plus a "Follow selected" button) intended for a future first-run "sources"
step. It is self-contained, importing only the shared `CreatorSeedRow` type and
`followCreatorAction`, but nothing in the shipped app mounts it yet.

## 2. Why it exists

A fresh install starts with zero tracked channels, and the first thing crowsnest needs from
a buyer is a small set of creators worth watching. Typing handles from memory answers a
different question than "who should I even watch in fitness," so discover turns that into a
browsable list with a curated reason attached to each name, grouped by niche. The reason
text is deliberately never a metric: `data/seeds/README.md` states the rule directly, `why`
must describe content style, format, or expertise, never a follower count, view count, or
engagement number, so the list cannot imply live stats the app has not actually measured for
an unfollowed creator.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Seed | One row in `creator_seeds`: a curated `(platform, handle)` pair with a niche and a one-line `why`. Seeds are content, not a user's data; they exist whether or not anyone has followed them. |
| Niche | One of four fixed values, `fitness`, `finance`, `tech`, `business`, each backed by a `data/seeds/<niche>.json` file of the same name. |
| Why | The curation rationale shown on every card in place of a follower or view count, enforced as metric-free by `data/seeds/README.md`'s no-metrics rule at curation time, not by a runtime check on the `why` column itself. |
| Follow | The one action a seed offers: `followCreatorAction` adds the handle as a tracked channel and queues a sync, calling the same `addChannelAction`/`startSyncAction` pair a manual channel add calls. |
| Tracked flag | Whether a seed's handle already has a live, non-deleted row in `channels`, computed by `listCreatorSeeds` with a left join at read time. It is never stored on the seed row itself. |
| Seed picker | `SeedPicker`, a self-contained multi-select variant of the same seed list, capped at a configurable number of selections (10 by default), built as a drop-in for a first-run step that does not exist yet. |

## 4. How it fits in the system

Discover sits upstream of the channels a rest of the app reads. It shows no video, no
outlier score, and no sync status of its own; the one thing it writes is a `channels` row
(via `addChannelAction`) and a queued sync job (via `startSyncAction`), exactly what
manually adding a channel from the channels board would write. Once a seed is followed, the
newly tracked channel behaves identically to any other channel: the sidecar sync fills it
in, and it becomes visible to the feed, the channels board, and everywhere else a `channels`
row is read. Discover itself never reads `videos`, `channels` beyond the tracked check, or
any scoring data.

`SeedPicker` is built to the same contract but currently has no mount point: it is not
imported by the first-run flow or by any route, so it is reachable only from its own test
file today.

## 5. Dependency map

### Upstream (what discover depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | `creator_seeds` (read), `channels` (read for the tracked check, write via `addChannelAction`). |
| `data/seeds/*.json` | The curated content `bootstrapCreatorSeeds` loads: one file per niche, `{ niche, label, creators: [{ handle, why, source }] }`. |
| `src/server/db/bootstrap.ts` (`bootstrapCreatorSeeds`) | Idempotent loader that turns the four seed files into `creator_seeds` rows on `npm run db:bootstrap`, keyed on `(platform, handle)`. |
| `src/server/services/sync-engine.ts` (`normalizeHandle`) | Validates and normalizes a handle before `followCreatorAction` touches the database. |
| `src/server/actions/sync-actions.ts` (`addChannelAction`, `startSyncAction`) | The exact add-channel and start-sync paths Follow reuses; discover owns neither. |

### Downstream (what depends on discover)

| Consumer | What it reads or uses |
| --- | --- |
| Channels board (`/channels`) | Reads the `channels` row Follow writes, indistinguishable from a manually added channel. |
| Sidecar sync | Runs the channel-scoped sync `startSyncAction` queues for a newly followed creator. |
| Feed, dashboard, and every other channel-reading surface | See the newly tracked channel once its sync has run; discover writes nothing they read directly. |
| A future first-run "sources" step | Expected to mount `SeedPicker` directly; not built yet. |

### External

| Dependency | Role |
| --- | --- |
| None directly | Rendering the discover page and its cards touches no external service. |
| Instagram sidecar (via `startSyncAction`) | Reached only once Follow queues a sync for the newly tracked channel, the same dependency any channel add already carries. |

## 6. Boundaries

Discover owns the curated seed list, its niche grouping, the one-click follow affordance,
and the (unmounted) multi-select picker variant. It does not own the `channels` table's
shape, the add-channel validation, or the sync queue, all of which belong to
`sync-actions.ts` and `sync-engine.ts`; discover only calls into them. It does not own
suggestion ranking (there is none: every niche shows its full curated list in a fixed
order) and it does not own the first-run flow that `SeedPicker` is built for but not yet
wired into.
