---
name: crowsnest-release-ci
description: Run, watch, debug, and summarize crowsnest full release validation against an immutable execution-plan behind a post-freeze release firebreak. Trigger:/crowsnest-release-ci
disable-model-invocation: true
---

# Crowsnest release CI

Use this with `crowsnest-release-maintainer` when a release candidate needs full
validation, install/update proof, or CI recovery. It runs and recovers the gate;
it never bumps a version, pushes a tag, or publishes.

## References

Read the deep material only when you reach that phase; keep this file for the
operational core.

| File | Read it when |
| --- | --- |
| `references/release-ci-notes.md` | Before an expensive proof or after a blocker: the firebreak rationale, the immutable execution-plan concept and its crowsnest TODO, the release-secret preflight and its R2 TODO, quota-safe recovery patterns, and the lessons from the openclaw lineage. |

## Guardrails

- No version bump, tag, publish, or promotion without explicit operator approval.
- After compaction, resume, or new steering, rewrite the effective goal and
  current phase from the latest explicit operator instruction. Do not merge old
  scope back into the active release.
- Hold the release scope once a release branch or Code SHA exists. Validate and
  ship that exact release; do not turn moving `main` into a second work queue.
- Record every active validation run as the immutable tuple **Validation SHA +
  Tooling SHA + rerun scope**. Validation SHA maps to the Code SHA for product
  validation or the Release SHA for changelog-only validation; it is not a third
  identity. A branch or temporary ref is context and transport, not identity.
- Freeze the candidate SHA and Tooling SHA once. Main lineage authorizes the
  initial Tooling SHA selection; it does not authorize replacing that tooling
  after `main` advances.
- Apply the release firebreak after the Code SHA is frozen: admit only defects
  that make the bytes unpublishable, queue everything else. Rationale and the
  exact admit list are in `references/release-ci-notes.md`.
- Use trusted `main` workflow revisions as immutable dispatch sources. Do not
  adopt newer main code, repair unrelated main CI, or wait for broad main health
  because the workflow source lives on `main`.
- Touch `main` only for an operator-requested change or the smallest critical
  main-owned blocker that prevents this release and cannot be handled from the
  release branch.
- Validate the release secrets and the live path before dispatching expensive
  proofs. crowsnest's live lane is Instagram: `npm run verify:live` needs a real
  IG account. There is no internal LLM key to validate (the MCP brain is
  deterministic; Claude or Codex is the only reasoning brain, supplied by the
  operator's own session). See the preflight section in the reference.
- Treat a live IG flake separately from a code failure: confirm session validity,
  the sidecar `/health` result, and the exact failing lane before editing code.
  A stale session-file token surfaces as a 401 and is a credential fix.
- Watch one run at a time with compact summaries. Avoid broad polling loops;
  `gh` API quota is easy to burn. Fetch logs only for failed or blocking jobs.

## Run identity and retry budget

Record Validation SHA, Tooling SHA, target ref, run id, attempt, and phase
before watching or recovering. Keep Code SHA and Release SHA as lifecycle roles;
they may name the same commit.

- Conceptual phases: `beta-publish` (a prerelease tag), `postpublish-confidence`
  (proofs against the published bytes), `stable-publish` (a stable tag). A
  prerelease run may defer the heavier post-publish proofs (Kit install/update
  against the real R2 artifact, live IG) to the confidence phase; record deferred
  checks as not run, never as passed. Stable requires the full roster.
- Keep at most one active run per Validation SHA + Tooling SHA + rerun scope.
- Recover one failed surface with one diagnosis, one fix when needed, and one
  narrow retry, then reassess. Do not automatically re-run everything.
- Narrow lane evidence does not by itself become publish authorization. Keep it
  in the evidence ledger for the release owner to judge against the publish gate.

crowsnest has no sealed execution-plan artifact yet; record the plan by hand and
re-confirm reused evidence. Full concept, and the workflow TODO, in
`references/release-ci-notes.md`.

## Preflight

Before the expensive proofs, against the frozen Code SHA in a clean checkout:

```bash
gh api rate_limit --jq '.resources.core'
git status --short --branch
git rev-parse HEAD
```

If the release touches IG code (`services/ig` or `src/server/ig`), confirm a
usable IG session is available for `npm run verify:live` before dispatch; a
model-list style "auth looks fine" is not proof, run the real live check. Do not
print secrets or session tokens. The release-secret preflight (R2 credentials,
and its TODO) is in `references/release-ci-notes.md`.

## Dispatch

The gate is two workflows plus local proofs.

- Pull-request and push CI is `.github/workflows/ci.yml` (ubuntu): `npm ci`,
  `npm run typecheck`, `npm run lint`, `npm test`, `bash scripts/testid-audit.sh`,
  `bash scripts/skill-lint.sh`. This is the product gate; it must be green on the
  Code SHA.
- The release workflow `.github/workflows/release.yml` runs on a `v*` tag push
  (macOS arm64): the test gate again, the `darwin-arm64` Kit bundle build, the
  fresh-HOME Kit smoke (install the tarball into a throwaway HOME, assert the IG
  sidecar `/health` returns 200), then the R2 upload. This is the publication
  gate; pushing the tag is what dispatches it, so it runs at publish time, not
  before.

To validate a candidate before tagging, run the CI gate on the Code SHA and the
release proofs locally against that exact SHA:

```bash
npm ci
npm run typecheck
npm run lint
npm test
bash scripts/testid-audit.sh
npm run build
bash packaging/build-bundle.sh <version> darwin-arm64 dist
```

The bundle build self-tests. For a stable candidate also exercise the fresh-HOME
Kit smoke the way `release.yml` does, against the built tarball, so the installer
contract is proven before the tag rather than only after. TODO: wire a
workflow-dispatch entry point on `release.yml` (or a dedicated validation
workflow) so the full release gate can run on a candidate SHA without first
pushing an immutable tag.

## Watch

Watch one run and read its terminal state precisely:

```bash
gh run watch <run-id> --repo Kaiships-ai/crowsnest --exit-status
```

- `in_progress`: no decisive blocker yet.
- `success`: all required jobs passed. Advisory or deferred lanes are not proven
  by this; check them explicitly.
- `failure` / `cancelled` / `timed_out`: a blocker. Diagnose the failed job, do
  not re-run the whole gate to discover what failed.

Stop watchers before ending the turn or switching strategy.

## Failure triage

1. Confirm the parent SHA and run id.
2. List failed jobs only:
   ```bash
   gh run view <run-id> --repo Kaiships-ai/crowsnest --json jobs \
     --jq '.jobs[] | select(.conclusion=="failure" or .conclusion=="timed_out" or .conclusion=="cancelled") | [.databaseId,.name,.conclusion,.url] | @tsv'
   ```
3. Fetch one failed job log. If rate-limited, note the reset time and stop
   making REST calls.
4. For an IG-looking failure, prove the live session from the same source before
   editing code (a 401 is a stale session-file token, not a code bug).
5. Classify before editing:
   - confirmed product/code failure: fix the release branch, freeze a new Code
     SHA, invalidate product evidence
   - tooling or workflow failure: keep the Code SHA, fix the smallest owning
     surface, retry only the failed surface with the recorded Tooling SHA
   - infrastructure or credential failure (R2 upload, IG session, runner):
     keep both SHAs, repair the external prerequisite, retry only the failed
     surface
   - changelog-only failure: change only `packaging/CHANGELOG.md`, keep the Code
     SHA evidence, re-prove the Release SHA
   Only the first class changes the Code SHA. After one diagnosis, fix, and
   narrow retry, reassess instead of starting another full cycle.

## Evidence

Record: the release lifecycle ledger (Code SHA, Release SHA, Tooling SHA); the
active CI and release-workflow run URLs, attempts, and conclusions; the Kit
bundle and fresh-HOME smoke result; the live IG check result when IG code
changed; targeted local proof commands; and any known gaps or unrelated
failures. Make the final note durable: run URLs, SHAs, command proof, and gaps.
For the recovery patterns and lessons behind these rules, read
`references/release-ci-notes.md`.
