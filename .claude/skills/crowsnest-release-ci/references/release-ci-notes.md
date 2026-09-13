# Release CI notes

Lessons and recovery patterns for the crowsnest release gate. Read this after an
early blocker, before dispatching an expensive proof, or when recovering a failed
surface. The firebreak and the immutable execution-plan idea below are the two
concepts worth keeping from the openclaw lineage; the rest is quota and secret
hygiene.

## The release firebreak

After the Code SHA is frozen, the candidate is closed to everything except
defects that make the bytes unpublishable. Admit only:

- confirmed product defects,
- packaging or provenance defects in the bytes to publish,
- security defects,
- failures that make publication impossible.

Queue every other finding for post-publish confidence or the next release. The
freeze exists so a green candidate does not absorb "while we're here" fixes. Each
admitted fix re-freezes a new Code SHA and invalidates the product evidence for
the old one, so treat admission as expensive.

## Immutable execution plan

openclaw sealed each full-validation dispatch into one immutable execution-plan
artifact: the original parent attempt, the exact child run tuples, the selected
coverage and gates, and the reuse identity. Decision, recovery, and verification
all consumed the same bytes, and a retry restored the plan from a run-id cache
rather than reconstructing it. Missing plan state was an orchestration failure,
not permission to rebuild the plan or redispatch.

crowsnest has no equivalent workflow. TODO: wire a `full-release-validation`
workflow that seals an execution-plan artifact per run so retries adopt the same
children instead of redispatching. Until then, record the plan by hand in the
state record: the exact Validation and Tooling SHAs, the CI run id and attempt,
the release-workflow run id and attempt, the selected gates, and any reused
evidence. Reused evidence is not trusted merely because it exists; re-confirm the
target SHA, the changed paths, and the run identity before treating a lane as
passed.

## Release-secret preflight

openclaw ran a provider-secret verifier before dispatching the expensive matrix.
Its point was that a present secret is not a valid secret: it made a real API
call (a tiny completion for the inference providers) so an exhausted or
non-billable credential failed before the matrix, not inside it, and it printed
only status, never the token.

crowsnest has no internal LLM key to validate (the MCP brain is deterministic;
Claude or Codex is the only reasoning brain, supplied by the operator's own
session). The two release secrets that must be real before publish are:

- the Cloudflare R2 credentials that `release.yml` uploads with, and
- a usable Instagram session for `npm run verify:live` when the release touches
  IG code (`services/ig` or `src/server/ig`).

TODO: wire an equivalent preflight check that proves the R2 credentials can
authenticate to the bucket (a HEAD or list against the target prefix, status
only, no secret output) before the tag is pushed, so a bad or missing R2 secret
fails at preflight rather than at the upload step of the publication gate. For IG,
run the real `npm run verify:live`; a "session looks present" check is not proof,
a stale session-file token surfaces as a 401 and is a credential fix, not a code
fix. Leave a bad credential unset: a failing candidate secret must not overwrite
a working one.

## What went wrong before

- Full validation was started before the live path was proven; secret presence
  was confused with secret validity.
- Repeated `gh run view` and log fetches exhausted the GitHub API quota.
- Parent run state was less useful than the individual child run evidence.
- Replacement runs were dispatched while an existing run was still recoverable,
  multiplying polling and identity checks.
- Live-lane flakes needed structured classification (invalid credential, empty
  output, timeout, real regression) before anyone edited code.
- Background watchers accumulated and made interruption recovery harder.

## Better defaults

- Run the secret and live-path preflight first. Prove the real path, not just
  presence.
- Keep one watcher open. Read compact summaries every few minutes, not every few
  seconds.
- Fetch a failed-job log only after the job reaches a terminal failing state.
- Prefer a narrow re-run of the failed surface. Create a fresh full run only when
  shared tooling changed, the earlier evidence is invalid, or the operator asks,
  and record the invalidating event; never widen to "run everything"
  automatically.
- Classify one failed surface, make one fix when needed, retry the narrowest
  failed lane once, then reassess whether to ship, waive, or block instead of
  spinning another verification loop.
- Once a run records its Validation SHA, Tooling SHA, and rerun scope, later
  `main` or release-branch movement does not replace any tuple member. The frozen
  candidate may stay behind the release branch only while it is still an ancestor;
  release tags stay exact.
- Make the final release-evidence note durable: run URLs, SHAs, command proof,
  and gaps.

## Quota-safe GitHub pattern

- Check `gh api rate_limit --jq '.resources.core'` before log-heavy work.
- Make one child-run listing call, then inspect only the failed jobs.
- If remaining quota is low, pause until reset instead of polling.
- Prefer GraphQL for metadata when REST is exhausted; logs still need REST.

## Not wired for crowsnest

The openclaw gate carried machinery crowsnest does not have. Do not port it; it
is listed here so its absence is deliberate, not an oversight.

- ClawHub, Docker image lanes, macOS app signing / notarization / appcast, and
  Windows Hub promotion: none exist. The only publish target today is Cloudflare
  R2 (`latest.json` + tarball + `install.sh`). npm publication and a GitHub
  release are TODO: wire, not current behavior.
- The `pnpm frv` attempt-aware controller, cross-OS advisory lanes, extended-stable
  transport refs, and the Testbox lease model: none exist. Recovery is manual and
  narrow, as described above.
