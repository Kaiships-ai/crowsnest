# Publish dry-run, full path against fake storage and graph

Runs the real `publishPlannedPost` (src/server/services/publish-post.ts) on a
ready plan with `claimed: true`, dry-run on (`PUBLISH_DRY_RUN` unset, non-production).
Storage and graph are fakes, so no network call and no live account is touched. This
proves the full path executes and the final `media_publish` is skipped.

## Call sequence

```
resolveVideoPath  -> /fake/evidence.mp4 (exists)
getStorageProvider  -> configured (fake)
isGraphConfigured  -> true (fake)
storage.upload  -> https://fake.example/crowsnest/evidence.mp4
graph.createReelContainer  video_url=https://fake.example/crowsnest/evidence.mp4 caption="Evidence dry run"
graph.pollReelContainer  FAKE_CONTAINER_1 -> FINISHED
writeRow  {"state":"published","dryRun":1,"publishedOwnPostId":null,"publishedAt":"2026-09-04T00:00:00.000Z","lastError":null,"errorClass":null,"updatedAt":"2026-09-04T00:00:00.000Z"}
storage.delete  crowsnest/evidence.mp4
```

## Result

```json
{
  "ok": true,
  "state": "published",
  "mediaId": null,
  "dryRun": true
}
```

## Assertions

- final media_publish skipped: yes (graph.publishReel never called)
- terminal state: published
- dryRun marker on the row: true
- object cleaned up: yes
