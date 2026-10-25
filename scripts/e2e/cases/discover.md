# Discover cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Seed list and follow | Curated, niche-grouped creator seeds with a follow action that reuses the manual add-channel and sync path | ● | `src/server/queries/discover.ts`, `src/server/actions/discover-actions.ts` | none |

Retired with the web app: the discover page and the first-run seed picker (former features 2 and 3). A Lead Studio board replaces them.

## Behavior notes

- Following writes only a `channels` row and a queued sync. The followed creator's posts appear in the feed after the sync runs. There is no autosave or draft state.
- Edge cases: bootstrap never run (empty list), soft-deleted channel with a seed's handle (seed shows untracked), sync already running at follow time (follow succeeds, no sync queued), dual-niche creator (shown once, under its curated niche).

## discover: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run this file: the route and action rows run offline with `pnpm test --project crowsnest` (vitest) against a temporary SQLite database (`src/server/queries/discover.test.ts`, `src/server/actions/discover-actions.test.ts`). `creator_seeds` is filled by `pnpm run db:bootstrap`. The web app's browser journeys, its jsdom component tests, and its :3001 dev server are retired with the web app.

## 1. behavior

Retired with the web app (the discover page and seed picker no longer exist): DISC-01 through DISC-12.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | drizzle query (`src/server/queries/discover.ts :: listCreatorSeeds`) | A seed's `tracked` flag is true only when its handle has a live `channels` row, and the optional `niche` argument filters the result. | Temp SQLite db, two seeds (`alpha`/tech, `beta`/fitness), `alpha` also inserted as a live tracked channel. | `listCreatorSeeds({ niche: "tech" })`, then `listCreatorSeeds()`. | The niche-filtered call returns one row (`alpha`, `tracked: true`); the unfiltered call includes `beta` with `tracked: false`. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | drizzle query (`src/server/queries/discover.ts :: listCreatorSeeds`) | A seed whose matching channel is soft-deleted (`deletedAt` set) is still returned, with `tracked: false`, because the join predicate carries the `deletedAt` check rather than a `WHERE` clause. | A seed `gamma` and a soft-deleted channel with the same handle. | `listCreatorSeeds()`. | `gamma` is present in the result with `tracked: false`, not dropped from the list. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | drizzle query (`src/server/queries/discover.ts :: listCreatorSeeds`) | Results are ordered by niche ascending, then handle ascending. | Seeds `zed`/tech, `amy`/tech, `mid`/business. | `listCreatorSeeds()`. | Order is `[business/mid, tech/amy, tech/zed]`. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | server action (`src/server/actions/discover-actions.ts :: followCreatorAction`) | A new handle adds the channel and starts a channel-scoped sync. | Temp SQLite db, no existing channel for the handle; `addChannelAction`/`startSyncAction` mocked. | `followCreatorAction("newcreator")`. | `addChannelAction` is called with `"@newcreator"`; `startSyncAction` is called with `[channelId]`; returns `{ ok: true, channelId, syncQueued: true, alreadyTracked: false }`. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/actions/discover-actions.ts :: followCreatorAction`) | An already-tracked handle is a no-op: neither `addChannelAction` nor `startSyncAction` is called. | A live tracked channel for `@existing`. | `followCreatorAction("existing")`. | Returns `{ ok: true, channelId, syncQueued: false, alreadyTracked: true }`; neither helper action is called. | 🟢 covered by vitest (green) |
| ACTION-06 | P1 | server action (`src/server/actions/discover-actions.ts :: followCreatorAction`) | A new handle whose sync loses the lock still reports success, with `syncQueued: false`. | `addChannelAction` resolves ok; `startSyncAction` resolves `{ ok: false, code: "SYNC_ALREADY_RUNNING" }`. | `followCreatorAction("busycreator")`. | Returns `{ ok: true, channelId, syncQueued: false, alreadyTracked: false }`, not an error. | 🟢 covered by vitest (green) |
| ACTION-07 | P1 | server action (`src/server/actions/discover-actions.ts :: followCreatorAction`) | A junk handle fails before touching `addChannelAction` or `startSyncAction`. | No setup needed. | `followCreatorAction("has spaces")`. | Returns `{ ok: false, ... }`; neither helper action is called. | 🟢 covered by vitest (green) |

Not checkable by hand:

- The real `addChannel`/`startSyncAction` round trip against a live sidecar; the rows above exercise `followCreatorAction`'s own branching with those two calls mocked, not the sidecar request itself.

## 3. browse-e2e

Retired with the web app: E2E-01 through E2E-09. No browser journey exists until a Lead Studio board is built.

## 4. security-lite

Discover reaches no external service of its own; `listCreatorSeeds` reads only the local
database. Follow's one outbound effect is the sync it queues through
`startSyncAction`, the same channel-scoped sync any manual "Add channel" already triggers,
covered by that component's own security-lite surface rather than duplicated here.

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P2 | No buyer data leaving the box | Following a seed sends only the handle to the add-channel and sync paths; no seed content (`why`, `source`) or other stored row leaves the box as part of a follow. | A seed with populated `why` and `source` fields. | 1. Follow that seed while inspecting the calls `followCreatorAction` makes to `addChannelAction` and `startSyncAction`. | Both calls carry only the handle (and, for the sync, the resulting channel id); `why` and `source` are never passed along. | 🟢 pass (browser + source): followed @davidmeltzer, single client POST fired, follow resolved to "Đang theo dõi"; `followCreatorAction` in `discover-actions.ts` calls `addChannelAction(normalized)` and `startSyncAction([added.channelId])`, neither accepts or forwards `why`/`source` (see test-shots/discover/SEC-01.png) |

Security-lite has no rows for secret handling or a license gate: discover reads and writes
only the local database and calls no service directly of its own. The sidecar shared token
is the sync queue's concern, not discover's; see the feed and ig-sync components' own
security-lite sections for that surface.
