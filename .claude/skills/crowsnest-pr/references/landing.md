# Publication and landing

Use under scoped publication or landing authority on `Kaiships-ai/crowsnest`.
Preserve source-trust, contributor-credit, and exact-head requirements.

## NEVER self-merge

Crowsnest review is thin-human-review: the machine produces a verdict plus
evidence and prepares a PR to merge-ready; a human clicks merge. Do not run
`gh pr merge` on your own work. "Land" here means driving a PR to merge-ready
(green required CI on the exact head, resolved review, non-null `mergeable`) and
reporting it, not merging it.

## Checkout and source

Work in a fresh worktree inside the allowed workspace (see `using-git-worktrees`);
preserve complete history and blobs for provenance. Untrusted PR code must not
execute locally with real credentials or against the operator's database; follow
the root source-trust rules. Do not weaken guards to accommodate missing
commands. Unset ambient `GITHUB_TOKEN` and `GH_TOKEN` when they could select the
wrong writer.

## Open or update the PR

Use a real body file for shell-sensitive text; keep problem, solution, user
impact, useful evidence, known gaps, and contributor credit current. Preserve
human credit and keep the branch maintainer-editable when safe. Crowsnest has no
`.github/pull_request_template.md` yet (TODO: wire one), so use those sections
directly. Update the change's owning doc under `documents/` in the same PR, per
the `CLAUDE.md` standing rule. `packaging/CHANGELOG.md` is release-owned
(`scripts/release-prep.sh`); a missing changelog is never a review finding.

```bash
gh pr create --repo Kaiships-ai/crowsnest --base main \
  --head <branch> --title <title> --body-file <body.md>
gh pr edit <pr> --repo Kaiships-ai/crowsnest --body-file <body.md>
```

Refresh or rebase only for a conflict, a failing guard, an explicit request, or
material stale-base risk, not merely because main advanced.

## CI and merge-ready

Required CI is `.github/workflows/ci.yml`: typecheck, lint, vitest,
`scripts/testid-audit.sh`, and `scripts/skill-lint.sh`. Confirm the run attaches
to and passes on the exact pushed head; watch one exact head and fetch failed
logs once:

```bash
gh pr checks <pr> --repo Kaiships-ai/crowsnest --watch
gh run view <run-id> --repo Kaiships-ai/crowsnest --log-failed
```

Re-run `autoreview` if the head changed substantively, not for a patch-identical
rebase or a mechanical head change. Address substantive human and bot findings
and resolve fixed conversations; a queued bot score is not a landing gate.

When CI is green, review is resolved, and GitHub reports non-null `mergeable`,
mark the PR ready (`gh pr ready <pr>`) and report it as merge-ready with a verdict
plus evidence. Stop there. A human merges.

## Closeout

After a human confirms the merge, verify the final merge commit is on current
main rather than trusting a local summary, and return the task checkout to
current main. Report the problem, the owner-level change, important proof and
limitations, contributor credit, and the linked final state in concise prose.
Record worthwhile follow-ups; do not manufacture another task after a bounded
request is complete.
