---
name: crowsnest-repair-sweep
description: Run scoped crowsnest issue/PR repair campaigns with batched workers, root-cause proof, and verified landing or closure. Trigger:/crowsnest-repair-sweep
disable-model-invocation: true
---

# crowsnest repair sweep

Use for a multi-item repair campaign over `Kaiships-ai/crowsnest` issues and PRs.
`AGENTS.md` and `CLAUDE.md` own repair and safety policy; `$crowsnest-pr` owns
per-item review, GitHub writes, and landing. The lead stays hands-on and
delegates independent work where useful. Keep the broom small: one cluster, one
branch, one PR, narrow proof, clear owner-visible evidence.

## Scope and authority

- Explicit refs imply a bounded ref campaign. Otherwise discovery defaults to
  five qualified items (maximum twenty per batch); a whole-queue request means
  continuing through that queue. Do not pad low-confidence findings.
- Honor requested workers and focus. Batched worker sweep defaults to 5 active
  proof workers; scale only on observed host resource health. Assigned is not the
  same as running.
- An explicit autonomous fix-and-land invocation covers scoped investigation,
  repairs, commits, pushes, and PRs prepared to merge-ready. Review, triage, or
  list wording stays read-only; fix-only stops before publication. NEVER
  self-merge: land through `$crowsnest-pr`, which prepares a merge-ready PR and
  hands the actual merge to a human. Never infer release, schema, config,
  credential, security, or product approval from campaign authority.

Use `$autoreview` for independent code review and `$crowsnest-pr` for each item's
GitHub workflow. Author-history research is conditional on a concrete question,
not a campaign prerequisite. Backlog rows under
`documents/architect/**/05-backlog-to-enhance.md` and `scripts/next-bug.sh` are a
discovery source alongside GitHub issues.

## Coordinate ownership

Assign each item or shared root-cause cluster one owner, a checkout, a frozen
source SHA, authorized actions, and a useful stopping condition. Duplicate
symptoms share an owner; repeated defect classes are repaired in the canonical
owner, not by parallel near-identical patches.

Use isolated per-item worktrees (see `ship:using-git-worktrees`) and preserve
unrelated files. Serialize shared fetch/ref/branch/worktree operations, PR
preparation, and merge-ready handoffs in short slots; never hold a slot across
coding, tests, or a remote wait. Pause only campaign-owned work under resource
pressure, and preserve patches, claims, proof, and checkpoints before
replacement. The lead may take over stalled work safely; it is not an
orchestration-only role.

Run gitnexus impact before editing any symbol and `detect_changes` before
committing (see `CLAUDE.md`). Each verdict-bearing worker inspects its relevant
dependency contracts directly. The lead verifies consequential results, not just
summaries. One independent `$autoreview` satisfies the code-review requirement;
use independent challenge for nontrivial repairs and closure evidence.

## Investigate and repair

Search existing work before creating another fix: current body/comments, live
state when it matters, and current source/history. Use bare PATH `gh` with narrow
JSON fields; reuse shared evidence and avoid unnecessary pagination.

Prefer, in this fixed order:

1. Prove the original behavior is already fixed on current main and close under
   the authorized scope with the canonical fix and evidence.
2. Finish and verify an existing useful editable PR, preserving human credit.
3. If that PR cannot safely be updated, create a credited replacement before
   closing it. Do not squash a contributor PR after replacing its ancestry.
4. Implement a new high-confidence repair when no suitable fix exists.
5. Record a concrete blocker or product/owner decision. A useful independent
   simplification may land under its own scope, but it does not close the bug.

A candidate needs a demonstrated current defect, an understood owner and bounded
impact, relevant dependency proof, and feasible validation. Repairs requiring new
dependencies, public-contract changes, security, persistence design, or product
judgment need their root approvals before implementation or landing. Preserve
useful investigation; do not work around the gate or count review-required work
as an accepted fix.

Repair the invariant at its owner, cover relevant siblings, and remove connected
obsolete paths when justified (root cause, not symptom). Do not add speculative
fallback layers or hardcode the reported example. Prefer simplicity without a LOC
quota. Update the owning doc under `documents/` in the same change, per the
`CLAUDE.md` standing rule. Keep release-note context in the PR;
`packaging/CHANGELOG.md` is release-owned.

## Proof and landing

Choose proportional proof. Trusted development runs locally: `npm run build`,
`npm run test`, `npm run lint`, `npm run typecheck`, and the relevant
`scripts/e2e` or `scripts/e2e-coverage.sh` run. Never describe a mock, skipped
test, old head, or unfinished soak as live proof.

Run `$autoreview` on each completed nontrivial candidate and resolve verified
findings. Re-review substantive changes or unresolved concerns; do not multiply
reviews for mechanical head movement. Address actionable human/bot findings
without a separate score-refresh gate.

Land through `$crowsnest-pr` only with green required CI on the exact head and
resolved review, and stop at merge-ready. Verify remote merge state and ancestry
before counting a merge as success. Refresh or rebase for conflicts, failed
guards, explicit requests, or material stale-base risk, not merely because main
advanced. Delete only owned temporary state.

For broad campaigns, a shared-main failure may justify one separately scoped
repair worker; check for an existing fix first. Do not duplicate that repair in
every PR or silently expand a bounded ref request into unrelated CI work.

## Gates and security boundary

Execution gates default closed. Change a gate only under explicit authority for
that window; record the original state and any agreed restoration before changing
it, and restore only when the window includes that restoration. Never reset all
gates as generic cleanup.

Do not stage unapproved security-sensitive work in a repair campaign. Route
vulnerability reports, CVE/advisory work, leaked secrets/tokens/keys, plaintext
secret storage, SSRF, XSS, CSRF, RCE, auth bypass, privilege escalation, and
sensitive data exposure to dedicated security handling. Trust explicit security
markers and labels; do not infer security handling from vague prose.

## Closure and reporting

Before closing, prove the reporter's primary outcome and affected surfaces are
fixed, not merely mitigated or diagnosed, and not merely fixed on main. Check fix
ancestry and containing tags when version claims matter; dates do not prove
inclusion. Seek independent challenge for uncertain or consequential closure
evidence. Disagreement, a still-broken surface, or an owner hold means leave
open. Product rejection is a maintainer decision, never an automatic cleanup
conclusion.

Recheck live state before mutation and explain the fixed behavior, canonical
commit/PR, known containing version, and useful proof. If a closure is
challenged, pause that closure work and correct the evidence before resuming.
More than fifty close/reopen actions require explicit count/scope approval.

Keep a resumable ledger of owner, source/head, outcome, proof/CI state,
PR/merge-ready state, credit, blockers, and cleanup. Count verified outcomes, not
planned or launched work. Report meaningful progress and each verified landing
with links; summarize final behavior, proof, remaining limitations, and checkout
state in natural prose.
