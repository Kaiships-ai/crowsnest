# Discover

Discover is a curated directory of Instagram creators to follow, at `/channels/discover`. A fixed list of real handles, one JSON file per niche, is loaded into a `creator_seeds` table by `npm run db:bootstrap`. The page groups the seeds under niche tabs (All, Fitness, Finance, Tech, Business) with one card per creator: handle, niche badge, and a one-line reason to follow. It is for a buyer with no tracked channels yet. A second component, `SeedPicker`, offers the same list as a capped multi-select inside the first-run sources step.

## Data it holds

- `creator_seeds` in `src/server/db/schema.ts`: `platform`, `handle`, `niche`, `why`, `source`, with a unique index on `(platform, handle)` (migration `drizzle/0025_black_titanium_man.sql`). Seeds are content, not user data.
- `data/seeds/{fitness,finance,tech,business}.json`: the curated source, shape `{ niche, label, creators: [{ handle, why, source }] }`. `data/seeds/README.md` is the curation contract.
- No follow state is stored. Whether a seed is tracked is computed on read from `channels`.

## Boundaries

- Owns: `src/server/db/bootstrap.ts` (`bootstrapCreatorSeeds`), `src/server/queries/discover.ts` (`listCreatorSeeds`), `src/server/actions/discover-actions.ts` (`followCreatorAction`), `src/components/discover/` (`DiscoverBoard`, `CreatorSeedCard`, `SeedPicker`), the discover route, the Discover nav entry in `src/components/layout/nav-items.ts`, and `scripts/verify-seeds.ts`.
- Called by: the sidebar nav (Sources group), the first-run sources step (`src/components/first-run/sources-step.tsx` mounts `SeedPicker`), `npm run db:bootstrap`.
- Calls: `normalizeHandle` in `src/server/services/sync-engine.ts`, then `addChannelAction` and `startSyncAction` in `src/server/actions/sync-actions.ts`. Discover never reads `videos` or scoring data.

## Invariants

- Follow reuses the manual add-channel path. `followCreatorAction` calls `addChannelAction` then `startSyncAction`; there is no second write pipeline.
- Follow is idempotent. A handle with a live `channels` row returns `alreadyTracked: true` and writes nothing. An invalid handle returns an error before any write. Losing the sync lock to a running sync still counts as a successful follow, reported as `syncQueued: false`.
- Bootstrap is idempotent. It reads the four files in a fixed order (`SEED_NICHES`, not globbed), trims each handle, strips a leading `@`, and skips rows already present for `(platform, handle)`.
- The tracked check lives in the join predicate, not a `WHERE`. `listCreatorSeeds` left-joins `channels` with `deletedAt IS NULL` in the `ON` clause, so a soft-deleted channel leaves the seed visible and untracked. `src/server/queries/discover.test.ts` guards this.
- Ordering is niche then handle, ascending. There is no ranking or personalization, and a creator belongs to exactly one niche.
- Niche tabs filter in memory. The page fetches the full list once; the query's `niche` parameter exists but the page does not pass it.
- `why` never carries a metric (no follower, view, or engagement number). This is a curation-time rule in `data/seeds/README.md`; no runtime check enforces it.
- `SeedPicker` caps selection at `maxSelect` (default 10), disables unchecked rows at the cap and tracked rows always, follows handles sequentially through `followCreatorAction`, and passes only successful channel ids to `onDone` (`src/components/discover/seed-picker.tsx`). A failed follow is dropped silently with no per-row error.
- With an empty `creator_seeds`, the board shows a message pointing at `npm run db:bootstrap` instead of an empty grid (`src/components/discover/discover-board.tsx`).
- `scripts/verify-seeds.ts` drops a handle only on an affirmative IG_NOT_FOUND. A private account is kept, and any other error stops the run rather than emptying the seed files.

## Where to look

- `src/server/actions/discover-actions.ts`
- `src/server/queries/discover.ts`
- `src/server/db/bootstrap.ts`
- `src/components/discover/discover-board.tsx`
- `src/components/discover/seed-picker.tsx`
- `data/seeds/README.md`
- `scripts/verify-seeds.ts`
