# Build the campaign artifact

Not wired for crowsnest today. This is an adapted stub kept so the workflow is
not lost.

openclaw ran a non-interactive **Campaign artifact** mode when a
`RELEASE_VALIDATION_ARTIFACT_PATH` env var was present: it read release inputs,
fetched a live maturity scorecard, ranked the priority surfaces to test, rendered
a campaign issue body, and wrote a JSON upsert artifact for a trusted publisher
to apply. GitHub stayed read-only in that mode.

crowsnest has none of the pieces this depends on:

- No campaign publisher, no `RELEASE_VALIDATION_ARTIFACT_PATH` contract.
- No live maturity scorecard to rank surfaces from.
- No canonical campaign issue with a hidden train marker.

TODO: wire an automated campaign artifact only if crowsnest later gains a
campaign publisher. It would, adapted:

1. Take the exact release version (`YYYY.M.PATCH`), release commit, and a pinned
   guidance SHA as inputs instead of env vars specific to openclaw.
2. Group user-visible and upgrade-sensitive changes since the previous release
   under the crowsnest surfaces (dashboard, IG connect/session,
   transcription/MCP, Kit installer, db migrate/backup) using release notes and
   `packaging/CHANGELOG.md`. There is no scorecard, so rank surfaces by change
   volume and risk by hand, or TODO: wire a surface catalog.
3. Render an issue body with a `<!-- crowsnest-release-validation:<train> -->`
   marker, one **Recommended testing** action and pass condition per surface
   (use `{{CROWSNEST}}` and `{{RESTART}}` placeholders, resolved in
   [human testing](human-testing.md)), and empty **Testing notes** cells.
4. Write a JSON upsert artifact for the publisher. TODO: wire the artifact schema
   and the publisher; until then, create or update the campaign issue by hand per
   [find or refresh the release campaign](campaign.md).

Until wired, skip this mode entirely and drive validation interactively.
