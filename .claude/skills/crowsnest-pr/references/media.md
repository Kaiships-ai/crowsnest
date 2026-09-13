# Proof media

Read only when publishing an authorized, inspected, sanitized capture to a PR or
issue.

## Capture

For a captioned crowsnest UI recording treated as validation, use the
`proof-video` skill before upload. Record against the seeded, mocked UI, the same
isolation the e2e harness uses (`CROWSNEST_DB_PATH=data/e2e.db`,
`scripts/seed-e2e.ts`, the dev server on a free port), never the operator's real
data or a live Instagram session unless the proof is specifically about live sync,
and then redact. The `crowsnest-e2e` Playwright lane produces screenshots and
videos against the mocked backend; `proof-video` burns in captions and produces
the polished MP4. A recording that shows an error state, a blank surface, or a
wrong result is a failed proof.

Keep the raw capture as evidence and never commit media or `.artifacts/` output
into a product branch. Inspect the entire capture for unrelated or private
content (a real Instagram handle, a session cookie, a burner credential) before
uploading under the PR's existing authorization.

## Upload

- Preferred: when the installed `gh` exposes `--attach`, use the repeatable flag
  on `gh issue`/`gh pr` `create`, `edit`, and `comment`. Example:
  `gh pr comment <pr> --repo Kaiships-ai/crowsnest --body-file <comment.md> --attach <proof.mp4>`.
- `--attach` video rules: accepted extensions are `.mp4`, `.mov`, and `.webm`; the
  local maximum is 100 MB and GitHub's account limit may be lower. Do not add
  `#alt` to a video path. `gh` inserts a bare URL so GitHub renders a player, and
  the uploaded asset cannot be deleted.
- Fallback: if the installed `gh` lacks `--attach`, upload with the
  user-attachments endpoint and embed the returned `.url` (images as
  `![alt](url)`, video as a bare line so GitHub renders a player):
  `curl -s "https://uploads.github.com/user-attachments/assets?name=<file>&content_type=<mime>&repository_id=$(gh api repos/Kaiships-ai/crowsnest --jq .id)" -X POST -H "Authorization: Bearer $(gh auth token)" -H "Accept: application/json" --data-binary @<file>`.
  For that endpoint, 422 = unsupported type and 404 = bad repo id or no push
  access. Use `content_type` `video/mp4`, `video/quicktime`, or `video/webm`.
  Transcode a Playwright webm for broad playback with
  `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p out.mp4`.

Uploads inherit repository visibility. Keep images embedded and video URLs on
their own lines for GitHub playback. Do not disclose private desktop content,
identifiers, or secrets.

TODO: crowsnest has no dedicated artifact store. For a non-media artifact or an
endpoint failure, attach it to the PR through an available `gh` path or link a
location the operator approves; do not invent an external destination.
