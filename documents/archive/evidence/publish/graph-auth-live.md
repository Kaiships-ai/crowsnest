# Live Graph auth check (own channel)

Runs the real `checkGraphTokenAction` (src/server/actions/graph-actions.ts), which
calls `GET /me?fields=id,username` on the Instagram Graph API with the
`IG_GRAPH_TOKEN` stored in the local secrets table. This is the same token the
publish path uses. Read-only; nothing is posted. The token itself is never read into
this file, only the returned status.

## Sanitized status

```json
{
  "configured": true,
  "state": "ok",
  "username": "kaiships.ai",
  "message": null,
  "checkedAt": "2026-09-03T21:41:43.189Z"
}
```

A `state` of `ok` with a `username` proves the stored token authenticates against
the real Graph API, so the publish path's auth precondition is satisfied on this
machine. The remaining live gap is the S3/R2 bucket (no S3 keys exist locally yet;
see 05-backlog and the PR body for the exact ask).
