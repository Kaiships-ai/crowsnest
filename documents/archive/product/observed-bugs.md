# Bugs seen in the running app, 2026-07-31

From Kai's screenshot of `/feed` plus a read of the code behind it. These are
defects in what already shipped, separate from features V1 still needs.

## Caption overlay is unreadable

The feed card lays the caption over the thumbnail in white bold with a gradient
scrim. On the one real post in the database, a bright screen recording of the
ChatGPT UI, the white text sits on near white and cannot be read at all. The
scrim (`linear-gradient(rgba(11,11,12,.6) 0%, rgba(11,11,12,0) 42%, rgba(11,11,12,.7) 100%)`
in `outlier-card.tsx`) fades to fully transparent across the middle of the card,
which is exactly where the headline sits.

A scrim tuned against one thumbnail is not a fix. Either the text gets its own
opaque backing, or it moves off the image, or the scrim covers the full text
block rather than the card's top and bottom edges.

## "1 results"

`src/app/(shell)/feed/page.tsx:109` prints the count with a hardcoded plural.
Reads "1 results" whenever a filter matches a single post.

## Platform chips promise two platforms the app cannot ingest

`filter-bar.tsx` offers TikTok and YT Shorts. `platform-chip.tsx` renders icons
for both. `schema.ts:36` documents the column as
`"instagram" | "tiktok" | "youtube_shorts"`.

Nothing ingests either one. The only sync path is instagrapi against Instagram.
Selecting those filters returns nothing, and there is no copy explaining why,
so it reads as an empty product rather than an absent feature.

The schema anticipating a platform is not the same as the product having it.
Scope has to rule on this: build the ingestion, or take the chips out.

## Checked and fine

Two things that looked suspect in the screenshot turned out to be wired:

- The topbar search opens the command palette (`topbar.tsx:39` calls `setOpen`
  from `useCommandMenu`). What the palette searches over is still worth a look,
  but the control is not dead.
- "Saved views" reads the real `savedFilters` table, passed into `FilterBar` as
  a prop, with an empty state when there are none.
