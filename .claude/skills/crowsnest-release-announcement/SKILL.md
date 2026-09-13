---
name: crowsnest-release-announcement
description: Draft a crowsnest beta or stable release announcement from changelog, tag, and distribution evidence, led by the exact update command users run. Trigger:/crowsnest-release-announcement
disable-model-invocation: true
---

# Crowsnest release announcement

Use this with `crowsnest-release-maintainer` after a release is live to draft an
announcement. Announcements never gate publication and need explicit posting
authorization.

## Evidence first

Before drafting, read the real release evidence:

1. The `## <version>` section of `packaging/CHANGELOG.md`.
2. The GitHub release body when one exists (see `crowsnest-release-maintainer`;
   it is a not-yet-wired surface today), or the git tag.
3. The R2 distribution: `latest.json`, the versioned tarball, and `install.sh`
   for the exact version (see `crowsnest-verify-release`).
4. Commits since the previous shipped version, or the operator-specified base.
5. Any validation status relevant to user confidence
   (`crowsnest-release-validation`).

Do not claim a full changelog audit unless you did it. If you only read the
generated release notes or one changelog section, say so and either audit
properly or draft with that stated limitation. Rank focus areas by the whole
release delta and expected user impact; do not let late fixes dominate. For
crowsnest, prioritize user-observable changes: the Kit installer and update
path, first-run onboarding and `kai kit init`, Instagram account connect and
session auth, transcription, the dashboard, and any data-safety or migration fix.

## Required copy: lead with the update command

Lead the announcement with the exact command users run to get the release. For
crowsnest that is re-running the one-line installer, which reads `latest.json` and
pulls the current version:

```sh
curl -fsSL https://get.crowsnest.sh/install.sh | sh
kai up
```

`kai up` brings the stack up after install or update. Put this near the top,
before any proof or validation note. A fresh install adds the license step:

```sh
curl -fsSL https://get.crowsnest.sh/install.sh | sh
kai login KSA-XXXX
kai kit init
kai up
```

Every beta announcement must also make beta status explicit and include:

- the exact version, for example `crowsnest 2026.5.25-beta.1`
- one-sentence risk framing: beta, useful for testing, not a stable install
- focused test areas derived from the evidence, not guesswork
- the GitHub release or tag link
- a concise validation note, without making CI the headline

For a stable announcement, use the same update command and drop the beta risk
framing. crowsnest is Apple Silicon only for v1; say so if the audience might not
know.

The openclaw lineage offered a channel-specific `--channel beta`/`--channel
stable` update flag. crowsnest has no channel flag today; a Kit updates by
re-running the installer against `latest.json`. TODO: wire a channel selector if
crowsnest wants separate beta and stable update tracks; until then keep the
single installer command above and state the version explicitly.

## Style

- Keep it skimmable: short intro, bullets, commands, links.
- Lead with what users can feel or test, not proof plumbing.
- Mention validation only after the install and update instructions.
- Be specific about where feedback is useful.
- Do not mention private local proof paths, R2 credentials, or IG account detail.
- Do not overstate unverified surfaces.

## Posting

crowsnest has no wired announcement channel or bot. Draft only, then hand the
copy-ready text to the operator; do not post automatically. TODO: wire the
posting target (the channel or list crowsnest announces on) if automated posting
is wanted. When posting is wired, resolve and visibly verify the exact
destination, inspect the final body, and request action-time confirmation before
sending. Never send from an unverified channel or with an embedded token.
