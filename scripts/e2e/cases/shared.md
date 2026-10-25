# Shared cases

Hand verification for crowsnest's shared, cross-cutting behavior: the data model, the
interaction model, navigation and the shell, background jobs, external services, status
and failure surfaces, and persistence. These are the claims that many components depend
on rather than any single one, which is why they live here instead of in a component's
own cases file.

## How to run a pass

The web app and its :3001 dev server are deleted, so every row that drove a screen is
retired below. The rows that stay read the database or the environment directly against a
seeded database with at least one tracked channel that is not the own channel, one
analyzed video, one saved post, and at least one planned post. Record `pass`, `fail`, or
`blocked` in the Result column; the placeholder below is `not run`.

Verified against commit `4f26fb9`. The parenthetical citations after each claim (for
example `([data-model.md#planned-post](../../../documents/architecture/data.md))`) link to the section of
the shared document the claim was read from. Every one of those documents now lives beside
this one under `documents/architect/shared/`, so a citation is a plain same-directory link.

## Data model

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DATA-01 | P1 | soft removed video, db read | Removing a video cascades: its saved post is deleted with it and any planned post that pointed at it keeps the plan but loses the link ([data-model.md#how-records-change-underneath-a-page](../../../documents/architecture/data.md)). | A present video that has a saved post and a planned post attached to it. | 1. Note the saved post and the planned post link.<br>2. Set the video's `deletedAt` (simulate a sync removal).<br>3. Re-read the saved post row and the planned post row. | The saved post row is gone; the planned post row still exists with its source video link now null. | not run |
| DATA-02 | P1 | db read | A planned post's stored `state` is only ever draft or scheduled; missed is derived on read and never stored ([data-model.md#planned-post](../../../documents/architecture/data.md)). | One draft plan (no date), one scheduled plan (future date), one plan with a past date. | 1. Read the `state` column of all three rows.<br>2. Read the plan through `src/server/queries/planned-posts.ts`. | No row stores missed; the past-dated plan reads as missed only when derived on read. | not run |
| DATA-05 | P1 | db read | Saving a script copies the chosen variant's text into the script's own content; the script does not stay linked to the live variant ([data-model.md#script](../../../documents/architecture/data.md)). | A remix session with stored variants, one chosen and saved as a script. | 1. Read the saved `scripts` row content.<br>2. Edit the session's variants.<br>3. Re-read the script content. | The script content matches the variant text at save time and does not change when the session's variants change. | not run |
| DATA-06 | P1 | db read | A planned post outlives its script, its remix session, and its source video; none of those deletions removes the plan, the links just go null ([data-model.md#edge-cases](../../../documents/architecture/data.md)). | A planned post linked to a script, a remix session, and a source video. | 1. Delete the script, then the source video.<br>2. Re-read the planned post row. | The planned post still exists; the script link and source video link are null. | not run |
| DATA-07 | P1 | db read | A saved post is capped at one row per video by a unique index ([data-model.md#saved-post](../../../documents/architecture/data.md)). | A video with no saved post yet. | 1. Save the post.<br>2. Attempt to save it a second time (or insert a second `savedPosts` row for the same video). | Exactly one saved post row exists for the video; the second attempt does not create a duplicate. | not run |
| DATA-08 | P2 | feed | A video can be a photo, a video, or a carousel; `mediaType` says which, and the `videos` table name predates that ([data-model.md#video](../../../documents/architecture/data.md)). | A feed with at least one non-video media type present. | 1. Read the `videos` rows for a carousel and a photo post. | Each is a `videos` row regardless of its media type; its `mediaType` distinguishes it. | not run |
| DATA-09 | P2 | db read | Exactly one channel can be the own channel, marked `isOwn` and enforced unique ([data-model.md#channel](../../../documents/architecture/data.md)). | A seeded database with an own channel set. | 1. Read the `channels` rows and count `isOwn` true.<br>2. Attempt to mark a second channel own. | At most one channel has `isOwn` true; a second is rejected or replaces the first, never coexists. | not run |
| DATA-11 | P2 | db read | An own post is a measured reality and a planned post is an intention; they are separate tables and are not automatically linked ([data-model.md#own-post](../../../documents/architecture/data.md)). | A database with both own posts and planned posts. | 1. Read a planned post row and look for any own post foreign key.<br>2. Read the `ownPosts` table. | Planned posts carry no automatic link to own posts; the tables stand apart. | not run |

Retired: DATA-03 (`createRuns` is not in `src/server/db/schema.ts`) and DATA-04 (drove the deleted remix screen; the one-session rule is covered in [remix](remix.md)).

Not checkable by hand:

- Whether `deletedAt` hides a video from every read or only from the feed ([data-model.md](../../../documents/architecture/data.md)); needs a trace through every query, not a single screen.

## Interaction model

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Retired with the web app (the web app's toasts, dialogs, and pending transitions no longer exist): INTERACT-01, INTERACT-02, INTERACT-03, INTERACT-05, INTERACT-06, INTERACT-07, INTERACT-08, INTERACT-09.

## Navigation and shell

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Retired with the web app (the Next.js shell, sidebar, tabs, redirects, first-run gate, and command menu no longer exist): NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, NAV-07, NAV-08, NAV-09, NAV-10, NAV-11, NAV-12, NAV-13, NAV-14, NAV-15, NAV-16.

## Background jobs

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BGJOB-06 | P1 | soft removed video, db read | A sync can remove a video that is gone from the source, and the removal cascades: its saved post is deleted and any planned post that pointed at it keeps the plan but loses the link ([background-jobs.md#the-sidecar-sync](../../../documents/architecture/jobs-and-failures.md)). | A present video with a saved post and a planned post linked. | 1. Simulate a sync removal (set `deletedAt`).<br>2. Re-read the saved post and the planned post. | The saved post is deleted; the planned post remains with a null source video link. | not run |
| BGJOB-11 | P3 | config read | The sync window and behavior are environment defaults read once at boot: a lookback of 30 days, at most 200 items per sync, 3 retries per retryable call, and an auto interval off by default (0 means no timed re sync) ([background-jobs.md#the-sidecar-sync](../../../documents/architecture/jobs-and-failures.md)). | Access to the environment defaults. | 1. Read the sync environment values at boot. | Lookback 30 days, cap 200 items, 3 retries, auto interval 0 (off) unless overridden. | not run |

Retired: BGJOB-01, BGJOB-02, BGJOB-03, BGJOB-04, BGJOB-05, BGJOB-07, BGJOB-08, BGJOB-09, BGJOB-10. They drove the deleted web screens or the cook run, whose `createRuns` table is not in `src/server/db/schema.ts`.

## External services

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Retired with the web app (the analyze gate, the connect panel, the my channel page, and the status panel no longer exist): EXT-01, EXT-04, EXT-05, EXT-06, EXT-07, EXT-10, EXT-11, EXT-12. The degradation rules stand in [external-services](../../../documents/architecture/external-services.md).

## Status and failures

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Retired with the web app (the failure strip, toasts, and run pills no longer exist): STATUS-01, STATUS-02, STATUS-03, STATUS-04, STATUS-05, STATUS-07, STATUS-08, STATUS-09, STATUS-10, STATUS-11, STATUS-13, STATUS-14, STATUS-16.

## Persistence

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PERSIST-01 | P1 | restart | Committed durable records (a saved post, a script, a planned post, a video analysis, the remix session) survive a restart because each is a database row ([persistence.md#the-layers-of-core-loop-state](../../../documents/architecture/data.md)). | A record of each kind present. | 1. Note a saved post, a script, a planned post, and an analysis.<br>2. Restart the server.<br>3. Read each row again. | Every committed record comes back unchanged. | not run |

Retired with the web app (the remix studio autosave, dialogs, URL state, and client state no longer exist): PERSIST-02, PERSIST-03, PERSIST-04, PERSIST-05, PERSIST-06, PERSIST-07, PERSIST-08, PERSIST-09, PERSIST-10, PERSIST-11, PERSIST-12, PERSIST-13, PERSIST-14, PERSIST-15.

