# The data model

## Summary

This document owns what each record in the core loop is, in the user's terms, and the states each can be in. Other documents link here instead of redefining a video, a planned post, a script, or a run. It is a reference, not an interaction, so it does not use the five phase skeleton. It does cover how records change underneath an open page, which every interrupt table depends on.

The core loop moves one object into the next: a video becomes the source of a remix session, the session produces a script, the script is carried by a planned post, and the planned post is driven by a create run into a rendered video. Each hop is a separate record, linked by id, so losing a later record never loses an earlier one.

```
stateDiagram-v2
    [*] --> video : sidecar sync writes it
    video --> remixSession : remix (one session per video)
    remixSession --> script : save a variant
    script --> plannedPost : finish the remix
    plannedPost --> createRun : cook in the studio
    createRun --> renderedVideo : success
```

## The objects

### Video

One top level post scraped from a tracked channel, the outlier the feed shows. The table is named `videos`, but a video can be a photo, a video, or a carousel; its `mediaType` says which. A video belongs to a channel and carries the metrics the feed ranks on: view count, like count, comment count, duration, posted date, and an outlier score computed against its channel's own baseline. Videos are written by the sidecar sync, never by the user. A video can be soft removed by a sync (it carries a `deletedAt`), which is how a video can disappear from the feed and cascade its saved post away underneath an open page.

A video's user visible states: analyzed or not (whether it has a video analysis), saved or not (whether it has a saved post), and present or removed (whether a sync has cleared it).

### Channel

An account whose posts are tracked. The table is `channels`. It carries the handle, display name, avatar, follower count, and platform. Exactly one channel can be the user's own channel, marked `isOwn` and enforced unique. The own channel is what the my channel page and the studio measure against; every other channel is a reference or competitor whose outliers fill the feed.

### Video analysis

The result of analyzing a video: its hook type, structure segments, format and style tags, a "why it worked" note, a summary, and a layout (the beats of the video). The table is `videoAnalyses`, one row per video. A video with no analysis row is unanalyzed, and the detail page shows a gate offering to analyze it.

### Transcript

The text of a video, from one of the transcript providers. The table is `transcripts`, with the text and its source. Analysis and remix research draw on it; a video can have none, in which case steps that need a transcript cannot run.

### Saved post

A video the user has kept for later, written by the keep this post button. The table is `savedPosts`, capped at one row per video by a unique index, carrying an optional free text note. Deleting the video removes the saved post with it.

### Remix session

A working session that turns one source video into a script through six stages. The table is `remixSessions`. It holds the topic, niche, target length, research notes, the generated hook options and the chosen hook, the chosen style vault item, the outline, the generated variants, and the chosen variant index. It is disposable working state; its durable outputs are a script and a planned post. There is one session per source video: opening the remix on a video gets the existing session or creates one.

The session's own state is its `stage`, one of prompt, research, hook, style, script, finish, recording how far it has gone.

### Stage

One of the six steps of a remix session, in order: prompt, research, hook, style, script, finish. The stepper shows them and the session's `stage` column records the furthest reached. Each stage is documented separately in the remix component.

### Variant

One of the candidate scripts the script stage generates, three by default, against three fixed angles. The user picks one, the chosen variant, before saving. Variants live inside the session until one is saved as a script.

### Script

The text a remix produces, saved as a `scripts` row. Saving a script copies the chosen variant's text into the script's own content; the script does not stay linked to the live variant. A script can be attached to a planned post. It links back to the remix session and the style vault item it came from for provenance.

### Planned post

A dated intention to publish on the user's own channel, optionally carrying a script. The table is `plannedPosts`. Its stored `state` is only ever draft or scheduled. Missed is derived on read when a scheduled date has passed without being marked published; nothing stores missed, because nothing runs to flip it. A planned post carries a title, an optional note, an optional date and time, a target length, a video kind, and links to its script, its remix session, and its source video. The user marks it published by hand (there is no code path from this table to any network call).

A planned post's states: draft (no date), scheduled (a future date), missed (a past date, derived), and published (marked by hand). A script it carried can also be detached, which the calendar shows distinctly from a plan that never had one.

### Create run

One cook pipeline execution in the studio: the process that cooks and renders a planned post into a video. The table is `createRuns`, with a status that is one of running, waiting, success, failed, or canceled, plus timestamps, a heartbeat, the rendered asset id when it succeeds, an error message when it fails, and the process id. This repo calls a create run a cook run. Its internals (the pseudo terminal and the websocket) are out of scope; the cook run document describes only the statuses the user sees. Background jobs owns the status meanings.

### Remix run

One generation attempt inside a remix session: a hook generation, an outline generation, or a variant generation. The table is `remixRuns`, append only, written on both success and failure. The run log on the remix page shows these. A remix run is not a create run; when a document says run without qualifying it, it says which.

### Vault item

A reusable snippet the remix draws on, typed as a hook or a style, in `vaultItems`. The style stage picks a style vault item; the research stage can pull items in as material.

### Own post

A post actually published on the user's own channel and measured through the Graph API, in `ownPosts`. Read only in this repo. The metrics tabs on the my channel page show these. An own post is a measured reality; a planned post is an intention. They are separate tables and are not automatically linked.

### App settings

Loose key and value settings in `appSettings`, read by various pages: the recently viewed list, saved filter defaults, and thresholds like `scoreMinUsablePosts`. See [persistence](persistence.md).

## How records change underneath a page

Because pages render on the server and re-read on navigation, a record can change between when a page loads and when the user acts on it. The cases that matter, referenced by every interrupt table:

- A video is removed by a sync. Its saved post is cascade deleted; its planned post keeps the link but the link goes null.
- A script is deleted or detached. The planned post's script link goes null; the planned post is never deleted with it.
- A planned post is edited in another tab. The two tabs hold different copies until one re-reads.
- A create run's status is updated by its process. The studio panel receives the new status and repaints its run pill.

## Edge cases

- The `videos` table name predates carousels and photos; a "video" is any tracked post regardless of media type.
- One session per video means a second attempt to remix the same video resumes the first session rather than starting fresh; restarting is an explicit action inside the session.
- A planned post can outlive its script (the link goes null), its remix session, and its source video; none of those deletions removes the plan.
- Missed is never stored, so a plan silently becomes missed as its date passes, with nothing writing a row.
