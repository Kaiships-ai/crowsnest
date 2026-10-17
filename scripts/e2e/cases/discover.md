# Discover cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | The discover page | Curated, niche-grouped creator cards with a one-click Follow | ● | `src/app/(shell)/(loaded)/channels/discover/page.tsx`, `src/components/discover/discover-board.tsx` | DISC-01, DISC-02 |
| 3 | The seed picker | Capped multi-select variant of the same seed list, mounted in the first-run sources step | ● | `src/components/discover/seed-picker.tsx`, `src/components/first-run/sources-step.tsx` | none |

## Behavior notes

- The discover page: niche tabs filter in memory. Follow disables on click, reads "Đang thêm…" while running, then "Đang theo dõi" and stays disabled, so a card is followed at most once per page load. A seed already tracked renders "Đang theo dõi" from first paint. An invalid handle shows a toast and returns the button to "Theo dõi". A follow while the Instagram service is down still adds the channel, starts no sync, and the toast says the posts are pulled when the service is back. A niche with no seeds shows "Không có creator nào trong nhóm này". Cards never show metrics.
- The seed picker: checkbox rows under the same niche tabs, capped at 10 selections, one "Follow selected" button. After the batch the selection clears. It is mounted only in the first-run sources step; there is no standalone route.
- Following writes only a `channels` row and a queued sync. The followed creator's posts appear in the feed after the sync runs. There is no autosave or draft state.
- Edge cases: bootstrap never run (empty-state message), soft-deleted channel with a seed's handle (seed shows untracked), sync already running when Follow is clicked (follow succeeds, no sync queued), dual-niche creator (shown once, under its curated niche).

## discover: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run this file: start the dev server and open `http://localhost:3001` (never
`127.0.0.1`), on a database that has run `npm run db:bootstrap` at least once, so
`creator_seeds` holds the curated list (113 rows across fitness, finance, tech, and
business). Seed a mix for the tracked-state cases: leave most seeds untracked, and add one
seed's handle as a tracked channel (and separately, one as a soft-deleted channel) to check
the tracked and untracked-after-removal paths. The discover page needs no external service
to render; only Follow's queued sync reaches the Instagram sidecar, and the sync itself, not
the follow call, is what needs the sidecar reachable. Offline route and action tests run
with `vitest` against a temporary SQLite database, covering `listCreatorSeeds` and
`followCreatorAction` (`src/server/queries/discover.test.ts`,
`src/server/actions/discover-actions.test.ts`). Two more `vitest` files exercise the
component layer in jsdom, `creator-seed-card.test.tsx` and `seed-picker.test.tsx`. All four
files, 12 tests total, pass today. Browse-e2e cases are driven with
the `browse` skill against the running dev server, per `references/browse-e2e-qa.md`, using
the real `data-testid` values the shipped markup carries: `creator-seed-card` and
`creator-seed-follow` on the discover page's cards, `discover-niche-filter` on its niche tab
list.

## 1. behavior

### The discover page

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DISC-01 | P1 | mouse | The page opens on curated creator cards grouped under niche tabs ([the discover page](#the-discover-page)). | Bootstrapped `creator_seeds`. | 1. Open `/channels/discover`.<br>2. Read the tabs and count the cards. | tất cả, fitness, finance, tech, business tabs are present; the All tab shows every seed as a card with a handle, niche badge, and why text. | 🟢 pass (browser): all, fitness, finance, tech, business tabs present, 111 creators across all niches (see test-shots/discover/DISC-01.png) |
| DISC-02 | P1 | mouse | The niche tabs filter the already-fetched list client-side, with no new server read ([the discover page](#the-discover-page)). | The discover page open on All. | 1. Click the Fitness tab.<br>2. Read the URL and the visible cards. | Only fitness-niche cards show; the URL is unchanged, no navigation or reload occurs. | 🟢 pass (browser): URL stayed `/channels/discover`, grid narrowed to 27 fitness cards, a business card (@barbaracorcoran) no longer present (see test-shots/discover/DISC-02.png) |
| DISC-03 | P1 | mouse | Follow transitions Theo dõi to Đang thêm… to Đang theo dõi, disabling the button throughout ([the discover page](#the-discover-page)). | An untracked seed's card. | 1. Click Follow, `data-testid="creator-seed-follow"`.<br>2. Watch the button through completion. | The button reads Đang thêm… and is disabled immediately, then Tracked and stays disabled once the follow resolves. | 🟢 pass (browser): followed @barbaracorcoran, button settled on "Đang theo dõi" and disabled, toast read "Following @barbaracorcoran. Pulling top posts now" (see test-shots/discover/DISC-03.png) |
| DISC-04 | P1 | mouse | A seed already tracked renders Follow disabled and reading Tracked from first paint, with no click needed ([the discover page](#the-discover-page)). | A seed whose handle is already a live tracked channel. | 1. Open `/channels/discover`.<br>2. Find that seed's card. | The card's button reads Tracked and is disabled without any interaction. | 🟢 pass (browser): the seeded `@hormozi` card read "Đang theo dõi" and its button was disabled on first paint (see test-shots/discover/DISC-04.png) |
| DISC-05 | P1 | sidecar reachable | Following a creator queues a channel-scoped sync through the same path a manual channel add uses ([the discover page](#the-discover-page)). | An untracked seed, sidecar running. | 1. Click Follow.<br>2. Check the channels board and the sync/runs surface for that channel. | The channel appears on `/channels`, tracked, with a sync queued or completed for it. | 🟡 blocked: IG sidecar down (also mutates: adds a channel) |
| DISC-06 | P2 | mouse | With `creator_seeds` empty, the page shows the empty state "Chưa có gợi ý creator nào." with `data-testid="discover-empty-line"` instead of an empty grid ([the discover page](#the-discover-page)). | An empty `creator_seeds` table. | 1. Open `/channels/discover`. | `data-testid="discover-empty-line"` shows; no bare empty grid. | 🟡 blocked: needs an emptied creator_seeds table, not reachable in this seeded db without mutating it |
| DISC-07 | P2 | mouse | A niche tab with no matching seeds shows "Không có creator nào trong nhóm này" rather than an empty grid ([the discover page](#the-discover-page)). | A niche filtered down to zero seeds (data manipulation). | 1. Select that niche's tab. | The "Không có creator nào trong nhóm này" message shows. | 🟡 blocked: every seeded niche (fitness, finance, tech, business) has creators; reaching zero needs mutating the seed data |
| DISC-08 | P2 | mouse | An invalid handle fails the follow with a toast and returns the button to idle Follow ([the discover page](#the-discover-page)). | A seed row whose handle has been edited in the database to something `normalizeHandle` rejects. | 1. Click Follow on that card. | A toast names the reason, and the button returns to the idle "Theo dõi" label rather than staying on "Đang thêm…". | 🟡 blocked: needs a seed row edited to a rejected handle, not present in this seeded db without mutating it |
| DISC-09 | P3 | mouse | A card never shows a follower count, view count, or any other metric ([the discover page](#the-discover-page)). | Any card. | 1. Read the full text of a card. | Only the handle, the niche badge, and the why text; no number resembling a stat anywhere on the card. | 🟢 pass (browser): card text was handle, niche badge, why text, Follow; no numeric stat (see test-shots/discover/DISC-09.png) |

Not checkable by hand:

- Whether the join-based tracked check ever drifts from the channels board's own tracked list under concurrent follows, a database-level race better suited to the route and action lens.

### The seed picker

`SeedPicker` has no route to open it from, so nothing here can be driven by mouse or
keyboard against the running app; each claim below is instead grounded in the component's
own jsdom test (`src/components/discover/seed-picker.test.tsx`), run directly against the
component rather than through a browser.

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DISC-10 | P2 | jsdom component test | The seed picker is mounted in the first-run sources step, and following a curated creator there is enough to continue with its channel id ([the seed picker](#the-seed-picker)). | `SourcesStep` with one seed, mocked `followCreatorAction` and `addChannelAction` resolving `ok: true`. | 1. Render `SourcesStep`, follow the seed, then click Continue. | Continue is enabled after the follow with no manual handle, and `onContinue` receives the seed's channel id. | pass (vitest, jsdom, not a browser run) |
| DISC-11 | P2 | jsdom component test | Selecting two seeds and clicking Follow selected calls `followCreatorAction` once per handle and reports only the succeeded channel ids ([the seed picker](#the-seed-picker)). | Two seeds, a mocked `followCreatorAction` resolving `ok: true` for both. | Render `SeedPicker`, check both rows, click `seed-picker-follow-selected`. | `followCreatorAction` is called with each handle; `onDone` is called with both resulting channel ids. | pass (vitest, jsdom, not a browser run) |
| DISC-12 | P2 | jsdom component test | With `maxSelect=10` and 11 seeds, an 11th selection is blocked and the button label caps at (10) ([the seed picker](#the-seed-picker)). | 11 unselected seeds, `maxSelect={10}`. | Check 10 rows, then attempt an 11th. | The 11th row stays unchecked and disabled; the follow button reads "(10)". | pass (vitest, jsdom, not a browser run) |

Not checkable by hand:

- Every seed-picker claim above, by a real mouse or keyboard, since there is no UI path to reach it; the jsdom component test is the only verification that exists today.

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
- The `CreatorSeedCard` and `SeedPicker` component tests are jsdom-rendered, not a drizzle query, server action, or API route, so their claims are grounded in the behavior lens above instead of here.

## 3. browse-e2e

Coverage: two built features carry a happy-path journey each, feature 2 (the discover page,
E2E-01, E2E-02) and feature 3 (the seed picker, E2E-03). Six corner-case types are covered:
`empty` (E2E-04), `invalid` (E2E-05), `concurrency` (E2E-06), `stale` (E2E-07), `boundary`
(E2E-08), and `repeat` (E2E-09).

Not applicable, with reason:

- `auth`: discover has no license, sidecar-token, or Graph-token gate of its own. It reads and writes only the local database and calls no external service directly (see security-lite below), so there is no auth refusal to drive through its UI.
- `network`: discover's only outbound effect is the sync it queues through `startSyncAction`, owned by background jobs. A down or unreachable sidecar never blocks discover's render or follow click, it only delays the queued sync, so there is no discover-owned failure state to observe mid-journey. The sync-lost-lock path is covered as `repeat`/`stale` behavior on the follow itself (E2E-07, E2E-09), not as a network error surface here.
- `failure` (an action that fails and shows its reason in an inline Alert, not a toast): discover has no inline failure strip of its own. A failed follow reports through a sonner toast, which is the `invalid` type (E2E-05); the empty-seed state has its own recovery copy (E2E-04). There is no inline-Alert surface to exercise.

Missing testids these journeys depend on are tracked as `DISC-07` in the
the GitHub backlog (label `backlog`): the discover-board empty-state message, the per-niche
tab triggers under `discover-niche-filter`, and a per-handle distinguishing attribute on
`creator-seed-card` / `creator-seed-follow` for targeting one specific card. Until those land,
the journeys below that need them fall back to `assert_text` on cleaned page text or to
positional targeting of the shared testid, as each row's Setup notes.

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 2 | happy | offline | Follow a creator from the discover page and see it flip to Tracked | Dev server up, bootstrapped `creator_seeds`, no channel yet for the target handle. Cards carry no per-handle testid yet (DISC-07), so the journey acts on the first card. | Arrive on `/channels/discover`. Act: read the count, `data-testid="discover-count"`; act on the first card, `data-testid="creator-seed-card"`; click its Follow button, `data-testid="creator-seed-follow"`. | The clicked `data-testid="creator-seed-follow"` reads "Đang thêm…" and is disabled immediately, then reads "Đang theo dõi" and stays disabled once the follow resolves (offline the queued sync is skipped, but the follow still succeeds). | `scripts/e2e/discover-e2e-01.sh` | 🟢 pass (browser): followed @bloomberg (first untracked card, since DISC-03 already tracked the true first card), button settled on "Đang theo dõi" and disabled, count stayed "111 creators" (see test-shots/discover/E2E-01.png) |
| E2E-02 | P1 | 2 | happy | offline | Filter the discover grid by niche client-side | Dev server up, bootstrapped `creator_seeds` (multiple niches present). Per-niche tab triggers have no testid yet (DISC-07), so the fitness tab is selected by its label text inside `data-testid="discover-niche-filter"`. | Arrive on `/channels/discover`, All tab active. Act: read `data-testid="discover-count"`; click the Fitness trigger inside `data-testid="discover-niche-filter"`. | `data-testid="discover-count"` changes from "N creator" to "M / N creator" for the fitness slice; the URL is unchanged (`assert_url_contains` still reads `/channels/discover` with no query change), confirming an in-memory filter and no server read; the card grid `data-testid="creator-seed-card"` shows only the filtered subset. | `scripts/e2e/discover-e2e-02.sh` | 🟢 pass (browser): count changed "111 creators" → "27 of 111 creators", URL unchanged (see test-shots/discover/E2E-02.png) |
| E2E-03 | P1 | 3 | happy | offline | Follow curated creators from the first-run seed picker | Dev server up, bootstrapped `creator_seeds`, first run not yet completed. Reaching the sources step drives the first-run welcome, focus, and connect steps (owned by the first-run component, out of discover's scope; the connect step is skippable). The seed picker mounts inside `data-testid="first-run-seed-picker"`. | Arrive on `/first-run` and advance to the sources step. Act: confirm `data-testid="first-run-seed-picker"` is present; check two untracked seeds by handle, `data-testid="seed-picker-checkbox-<handle>"` (per-handle, targetable); click `data-testid="seed-picker-follow-selected"`. | Before the click `data-testid="seed-picker-follow-selected"` reads "Follow selected (2)"; after the batch resolves it reads "Follow selected (0)" and is disabled, and each followed row's `data-testid="seed-picker-checkbox-<handle>"` is now disabled (the row shows its Tracked badge). | `scripts/e2e/discover-e2e-03.sh` | 🟡 blocked: this seeded db already completed first run (13 channels tracked), so `/first-run` redirects straight to the dashboard; reaching the sources step needs resetting first-run state, a mutation |
| E2E-04 | P2 | 2 | empty | offline | Empty creator_seeds shows the bootstrap recovery copy | Dev server up against a database whose `creator_seeds` table is empty (bootstrap never run). The empty-state message has no testid yet (DISC-07), so the assertion reads cleaned page text. | Arrive on `/channels/discover`. Act: read the page body. | `assert_text` finds the recovery copy naming "npm run db:bootstrap"; no `data-testid="creator-seed-card"` and no `data-testid="discover-niche-filter"` are present (the grid and tabs never render on the empty branch). | `scripts/e2e/discover-e2e-04.sh` | 🟡 blocked: needs an emptied creator_seeds table, not reachable in this seeded db without mutating it |
| E2E-05 | P2 | 2 | invalid | offline | An invalid handle fails the follow and returns the button to idle | Dev server up, bootstrapped `creator_seeds`, with one seed row's handle edited in the database to a value `normalizeHandle` rejects (for example "has spaces"). Cards have no per-handle testid yet (DISC-07), so the journey acts on that seed's card positionally. | Arrive on `/channels/discover`. Act: click Follow on the junk-handle card, `data-testid="creator-seed-follow"`. | The follow rejects before any sidecar call; `assert_text` finds the error toast copy; `data-testid="creator-seed-follow"` returns to reading "Theo dõi" and is enabled again, not stuck on "Đang thêm…". | `scripts/e2e/discover-e2e-05.sh` | 🟡 blocked: needs a seed row edited to a rejected handle, not present in this seeded db without mutating it |
| E2E-06 | P2 | 2 | concurrency | offline | A double click follows a card at most once | Dev server up, bootstrapped `creator_seeds`, no channel yet for the target handle. Acts on the first card (no per-handle testid, DISC-07). | Arrive on `/channels/discover`. Act: click `data-testid="creator-seed-follow"` on the first card, then immediately click the same `data-testid="creator-seed-follow"` a second time. | The button disables on the first click (`data-testid="creator-seed-follow"` reads "Đang thêm…" then "Đang theo dõi"), so the second click is a no-op; on reload the same card's `data-testid="creator-seed-follow"` reads "Đang theo dõi" exactly once, and `data-testid="discover-count"` is unchanged (one channel, not two). | `scripts/e2e/discover-e2e-06.sh` | 🟢 pass (browser): double-clicked @cnbc's Follow button, settled on "Đang theo dõi", db query confirmed exactly 1 channels row for handle cnbc, count stayed "111 creators" (see test-shots/discover/E2E-06.png) |
| E2E-07 | P2 | 2 | stale | offline | The optimistic Tracked state survives a reload from the database | Dev server up, bootstrapped `creator_seeds`, no channel yet for the target handle. Acts on the first card (no per-handle testid, DISC-07). | Arrive on `/channels/discover`. Act: click `data-testid="creator-seed-follow"` on the first card and wait for "Đang theo dõi"; reload `/channels/discover`. | Right after the click the button flips to "Đang theo dõi" optimistically (card-local state); after the reload the same card re-reads from `listCreatorSeeds` and `data-testid="creator-seed-follow"` still reads "Đang theo dõi" and is disabled from first paint, confirming the optimistic state and the persisted row agree. | `scripts/e2e/discover-e2e-07.sh` | 🟢 pass (browser): followed @businessinsider, button read "Đang theo dõi" before reload; after a full reload it still read "Đang theo dõi" and disabled from first paint (see test-shots/discover/E2E-07.png) |
| E2E-08 | P2 | 3 | boundary | offline | The seed picker caps selection at maxSelect | Dev server up, bootstrapped `creator_seeds` with at least eleven untracked seeds reachable on the All tab; first-run sources step reached (see E2E-03 Setup for the first-run dependency). `SeedPicker` mounts with `maxSelect=10`. | Arrive on the first-run sources step, `data-testid="first-run-seed-picker"` present. Act: check ten untracked seeds by handle, `data-testid="seed-picker-checkbox-<handle>"`; attempt to check an eleventh, `data-testid="seed-picker-checkbox-<handle>"`. | After ten checks `data-testid="seed-picker-follow-selected"` reads "Follow selected (10)"; the eleventh `data-testid="seed-picker-checkbox-<handle>"` is disabled and stays unchecked, so a new pick cannot bump an existing one off. | `scripts/e2e/discover-e2e-08.sh` | 🟡 blocked: same first-run-already-completed gap as E2E-03 |
| E2E-09 | P2 | 2 | repeat | offline | Re-following a handle whose channel was soft-deleted behaves like a first follow | Dev server up, bootstrapped `creator_seeds`, with one seed's handle also present as a soft-deleted channel (`deletedAt` set). That seed still renders untracked (its card's Follow is enabled). Acts on that seed's card positionally (no per-handle testid, DISC-07). | Arrive on `/channels/discover`. Act: click Follow on the soft-deleted seed's card, `data-testid="creator-seed-follow"`. | The follow succeeds (revives the soft-deleted row rather than erroring or duplicating); `data-testid="creator-seed-follow"` reads "Đang theo dõi" and stays disabled, and on reload the same card still reads "Đang theo dõi", confirming an upsert not a duplicate row. | `scripts/e2e/discover-e2e-09.sh` | 🟡 blocked: no seed handle in this db matches a soft-deleted channel handle; also mutates on follow |

## 4. security-lite

Discover reaches no external service of its own on render; the niche tabs and the card grid
read only the local database. Follow's one outbound effect is the sync it queues through
`startSyncAction`, the same channel-scoped sync any manual "Add channel" already triggers,
covered by that component's own security-lite surface rather than duplicated here.

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P2 | No buyer data leaving the box | Following a seed sends only the handle to the add-channel and sync paths; no seed content (`why`, `source`) or other stored row leaves the box as part of a follow. | A seed with populated `why` and `source` fields. | 1. Follow that seed while inspecting the calls `followCreatorAction` makes to `addChannelAction` and `startSyncAction`. | Both calls carry only the handle (and, for the sync, the resulting channel id); `why` and `source` are never passed along. | 🟢 pass (browser + source): followed @davidmeltzer, single client POST fired, follow resolved to "Đang theo dõi"; `followCreatorAction` in `discover-actions.ts` calls `addChannelAction(normalized)` and `startSyncAction([added.channelId])`, neither accepts or forwards `why`/`source` (see test-shots/discover/SEC-01.png) |

Security-lite has no rows for secret handling or a license gate: discover reads and writes
only the local database and calls no service directly of its own. The sidecar shared token
is the sync queue's concern, not discover's; see the feed and ig-sync components' own
security-lite sections for that surface.
