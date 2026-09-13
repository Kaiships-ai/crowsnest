# Find or refresh the release campaign

A campaign is the shared tracking issue that collects tester feedback for one
release train. Testing always targets an immutable candidate SHA (see
[prepare an isolated candidate checkout](gateway-preparation.md)).

## Versioning

crowsnest proposes CalVer `YYYY.M.PATCH` for release trains (a new adoption, not
an established scheme). Normalize a candidate tag to its train and use the train
as the campaign identity. Release cutting is `scripts/release-prep.sh <ver>` then
`.github/workflows/release.yml`; the Kit changelog is `packaging/CHANGELOG.md`.

## No automated runner today

openclaw dispatched a `release-validation-skill-runner` workflow that created and
maintained a canonical campaign issue. crowsnest has no such workflow. TODO:
wire a `release-validation` campaign runner workflow and a canonical campaign
issue with a hidden train marker if unattended campaign tracking is wanted.

Until then, track the campaign by hand in a single GitHub issue:

- When the tester supplies an issue URL or number, resolve it directly with
  `gh issue view <n> --json number,state,labels,body,url`. Accept it only when it
  is open and carries a `release-validation` label. Read the current candidate
  from the body.
- When no issue is supplied, find the campaign with one bounded lookup and never
  fall back to an unbounded scan:

  ```sh
  gh api 'repos/Kaiships-ai/crowsnest/issues?state=open&labels=release-validation&per_page=2'
  ```

  Ignore pull requests. Require at most one labeled issue. Multiple issues are a
  conflict: show their URLs and stop.
- If no campaign issue exists, either create one by hand for this train or
  proceed with a local-only worksheet and skip the campaign comment at closeout.

## Announce

When a campaign issue exists, announce it once with a bare URL and no commentary:

```text
Issue: https://github.com/Kaiships-ai/crowsnest/issues/<number>
```

Then record the train and the candidate SHA. After the candidate checkout is
prepared, show `Test target: <version> at <full SHA>`. Do not prepare a checkout
without knowing the train being validated.
