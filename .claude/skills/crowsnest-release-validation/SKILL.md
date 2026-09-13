---
name: crowsnest-release-validation
description: Guide a human tester through a crowsnest release candidate on an isolated build, collect their feedback, and produce a reviewable report. Trigger:/crowsnest-release-validation
disable-model-invocation: true
---

# Crowsnest release validation

Help a human test an isolated crowsnest release candidate against a disposable
copy of their state. Automate preparation, triage, and reporting; the human
drives the interactive surfaces and judges quality. This skill collects feedback,
not a release go/no-go decision.

Release reality: cut with `scripts/release-prep.sh <ver>` then
`.github/workflows/release.yml`; the Kit changelog is `packaging/CHANGELOG.md`;
publish target is Cloudflare R2 (latest.json, tarball, install.sh). CI is
`.github/workflows/ci.yml`. Versioning is proposed CalVer `YYYY.M.PATCH`. There
is no npm publish and no GitHub release step today (TODO: wire).

## Modes

- **Validate release:** the default human-testing workflow below.
- **Update campaign:** refresh the campaign for a tag. See
  [find or refresh the release campaign](references/campaign.md); crowsnest has no
  automated runner today, so track it by hand.
- **Campaign artifact:** not wired for crowsnest. See
  [build the campaign artifact](references/campaign-artifact.md).

## Human validation

1. Introduce the run briefly: pick the candidate build, protect the tester's
   state with an isolated copy, prepare the build, then test and review feedback.
   crowsnest has no packaged-skill update check (see
   [installed skill check](references/skill-update.md)), so skip it.
2. Find the campaign, if any: [find or refresh the release campaign](references/campaign.md).
3. Prepare an isolated candidate checkout at the exact SHA, built on an isolated
   `HOME`: [prepare an isolated candidate checkout](references/gateway-preparation.md).
   Never use the caller's checkout or the tester's real state.
4. Only after readiness, optionally offer
   [local diagnostics](references/local-diagnostics.md), then run
   [worksheet and human testing](references/human-testing.md), one surface at a
   time.
5. On `finish validation`, do
   [cleanup and report approval](references/report-closeout.md).

Before readiness is confirmed, show only the candidate identity and prep progress
or errors. Do not expose testing instructions or create a worksheet for a build
that never became ready.

## Reference map

| File | When to read it |
| --- | --- |
| [references/campaign.md](references/campaign.md) | Find or refresh the campaign tracking issue; versioning; no automated runner. |
| [references/gateway-preparation.md](references/gateway-preparation.md) | Prepare the isolated candidate checkout: resolve the SHA, clone, npm ci and build on an isolated HOME, prove containment. |
| [references/local-diagnostics.md](references/local-diagnostics.md) | Optional opt-in capture of the candidate's own logs into a private dir; version-match TODO. |
| [references/human-testing.md](references/human-testing.md) | Build the worksheet, guide surface testing, investigate each reported problem. |
| [references/report-closeout.md](references/report-closeout.md) | On `finish validation`: teardown, terminal result, final report draft, approval and posting. |
| [references/structured-report.md](references/structured-report.md) | Optional hidden JSON payload for a dashboard (not wired; skip if unused). |
| [references/tooling-feedback.md](references/tooling-feedback.md) | On the first setup or cleanup failure: write a private, redacted tooling packet. |
| [references/campaign-artifact.md](references/campaign-artifact.md) | Automated campaign artifact mode; not wired for crowsnest (stub). |
| [references/skill-update.md](references/skill-update.md) | Installed-skill update check; not wired for in-repo skills (stub). |
| [assets/validation-worksheet.md](assets/validation-worksheet.md) | Template to copy for a run's private worksheet (surfaces and placeholders). |
| [assets/tooling-feedback.md](assets/tooling-feedback.md) | Template to copy for the private tooling-feedback packet. |

## Boundaries

An isolated build must keep every candidate-writable path inside the disposable
location; do not bypass a failed containment check with manual copying. Copying
the tester's IG session or credentials into the candidate needs explicit
authorization and a restoration plan, because a candidate can invalidate a live
session-file token. Only tester-authored results count as tested. Public feedback
excludes raw logs, paths, account handles, identifiers, credentials, and setup or
cleanup detail. `finish validation` does not authorize posts; explicit batch
approval does. This skill collects release feedback; it does not make the go/no-go
decision.
