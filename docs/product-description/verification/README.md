# Hand verification

The feature documents were written from the code and the tests. This directory is the protocol for checking them against the running product, one observable claim at a time.

## What is here

| File | Covers |
| --- | --- |
| [foundations.md](foundations.md) | `foundations/*` |
| [feed.md](feed.md) | `feed/*` |
| [remix.md](remix.md) | `remix/*` |
| [mine.md](mine.md) | `mine/*` |
| [studio.md](studio.md) | `studio/*` |
| [cross-cutting.md](cross-cutting.md) | `cross-cutting/*` |

Each file has one table per document. Each row is an item with a stable id (`FEED-07`, `REMIX-12`), a priority, what it needs (a device, a network condition, a service state), the claim with a link to the document section, the setup, numbered steps, the expected result, and a Result column for the tester. Items that cannot be checked by hand are listed under each document as "Not checkable by hand".

Priorities: P1 is an established fact, a claim many documents depend on, or a suspected bug from [bug-triage.md](../bug-triage.md); P2 is an ordinary claim; P3 is a number, a color, or a timing.

## How to run a pass

1. Bring up the surface. Start the dev server and open `http://localhost:3001` (never `127.0.0.1`; the dev server can silently block server actions on the wrong host). Use the default seeded configuration and a database with at least one tracked channel with analyzed videos, so the feed and the remix have something to work on. For a clean pass, note the state you start from so you can tell a real change from leftover data.
2. Confirm the commit. Every document says it was verified against commit `4f26fb9`. That is the code commit the docs were read from; the docs live on top of it in the same repo. If the working tree's `src` has moved since, some failures will be drift, not defects. The docs footer pins the code commit on purpose; check `git log` for changes under `src/` since `4f26fb9`.
3. Keep the documents open beside the product. Read the linked section before each item; the item is a summary, the section is the claim.
4. Work through P1 first across all files, then P2, then P3.
5. Record `pass`, `fail`, or `blocked` in the Result column, with a note for anything other than a clean pass. A fail is something the document says that the product does not do. A blocked item could not be run (a service was up when the item needs it down, no second tab, a prior failure in the way).
6. File every fail in [bug-triage.md](../bug-triage.md). If an entry already exists (many P1 items map to an existing B-NN), add a Status line to it quoting the item id and the date. If not, add a new entry with the item id under "Raised by". A fail is not automatically a product bug; sometimes the document is wrong, and the fix is to the document. Say which in the Status line.
7. When every P1 and P2 item for a document has passed or been filed, change its row in the [coverage table](../README.md#coverage) from `drafted` to `verified`.

## Devices and conditions

- Mouse and keyboard: the default. Arrow key navigation on the video detail page needs the keyboard with focus outside a text field.
- LLM proxy down: stop the local proxy (or unset `LLM_BASE_URL`) to check the generation blocked panel and the proxy down inference. Distinct from no key: unset `ANTHROPIC_API_KEY` for the no key state, which reads differently.
- Graph token invalid: clear or invalidate the Graph token to check the connect panel and the unavailable metrics on the my channel page.
- Sidecar off: stop the sidecar to check that the feed goes stale rather than erroring and that downstream actions still work.
- A second tab: open the same record in two tabs to check the double action and last write wins rows. A second tab is not a second browser; it shares the session.
- A soft removed video: mark a video `deletedAt` to check the record changes underneath rows.

## Driving the product

This repo has a test suite (`npm test`, vitest) that already exercises the server actions, the services, and the queries as executable specifications. Those cover what happens (the database writes, the derived states, the error codes) but not what is shown on screen or how long it takes to appear. A verification pass is for the visible half: what renders, what a toast says, what a pill shows, what a reload restores. Do not mark a document `verified` on the strength of the test suite alone; the tests are green at this commit and did not catch the issues in [bug-triage.md](../bug-triage.md), which are about what the user sees and what survives a reload.

Where a claim is purely about a database write or an exit state, the test suite or a direct database read can stand in, and the item says so. Where a claim is about the screen (a stuck skeleton, a missing pill after reload, a red missed cell on a published plan), it needs eyes on the running product.

## Results so far

One scripted read pass has run against the running dev server on localhost:3000, using HTTP GET on server rendered pages and direct database reads. It checked what pages render and what the database holds. It did not click anything, watch a toast, drive a cook run, or reload mid action, so the interactive claims (dialogs, run pills, autosave on blur, the reload behaviors) are untouched. The dev database was well populated: 627 videos, 24 analyzed with transcripts, 14 channels, an own channel, 3 planned posts, 13 scripts, 15 remix sessions.

What it confirmed:

- B-10: all 24 analyzed videos have a null or empty summary, and the analyzed video detail page renders an empty Summary section. Confirmed.
- B-14: requesting a video detail URL for a non existent id returns HTTP 200, not 404. Confirmed.
- The analyzed detail page renders the analysis (why it worked), the median baseline, and the engagement rate, as the document says.

What it found consistent but could not prove without a browser:

- B-01 and B-08: no planned post in the database is hand published (`publishedOwnPostId` is null on all), which is what both bugs would produce, but also matches a user who never published. A live Save to calendar and a reload are needed to prove them.

What it could not confirm:

- The studio brief on the one plan checked showed a Visual direction section without the "Frame pass not run" text the document expects. Either that plan carries a stored layout or the wording differs; this needs the specific plan and wording checked by eye.

Most items remain `—`. No document is marked `verified`, and none should be until the interactive pass fills the rest. The scripted pass covers output and stored state, not what a user sees happen, per the note above.
