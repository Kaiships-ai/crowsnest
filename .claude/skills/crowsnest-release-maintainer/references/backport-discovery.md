# Backport discovery (not wired for crowsnest)

The upstream project runs an evidence-driven backport audit before cutting a
maintenance release from an older base: pin the maintenance baseline and the
`origin/main` SHA, enumerate every commit since the last accepted scan cursor,
remove only patch-equivalent commits, reconcile security advisories, and present
a categorized ledger for maintainer approval before mutating any release ref.
Clean cherry-picks are triage evidence, never approval.

crowsnest does not maintain parallel release lines today. Every release cuts from
`main`, and the active release is the whole work queue, so there is nothing to
back-port between lines. This concept is NOT yet wired for crowsnest.

TODO: wire a backport-discovery procedure if crowsnest ever ships a long-lived
maintenance branch alongside `main`. It would need: a durable scan cursor, a
detached-worktree applicability probe (`git cherry-pick --no-commit` then
`git diff --check`), and an operator-approved ledger before touching any release
branch. Until then, do not back-port; fix forward on `main` and cut a new
version.
