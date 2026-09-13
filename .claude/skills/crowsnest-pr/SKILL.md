---
name: crowsnest-pr
description: Review, triage, repair, or land crowsnest issues and pull requests with current-source evidence. Trigger:/crowsnest-pr
disable-model-invocation: true
---

# crowsnest PR

Use for the requested crowsnest issue or PR operation on `Kaiships-ai/crowsnest`.
`AGENTS.md` and `CLAUDE.md` own repair, product, source-trust, docs, and approval
policy; this skill owns the GitHub workflow. A pasted ref is context, not
permission to publish or expand the task.

## References

Read the reference for the phase you are in; do not inline its detail here.

| File | Read it when |
| --- | --- |
| [references/triage.md](references/triage.md) | Queue discovery, related-item research, assignment decisions, or an authorized label or close. |
| [references/attribution.md](references/attribution.md) | Contributor identity or a regression's introducing commit matters to a concrete decision; the commit trailer convention. |
| [references/landing.md](references/landing.md) | Before publishing or driving a PR to merge-ready: checkout, PR body, CI, and the never-self-merge handoff. |
| [references/media.md](references/media.md) | Publishing an authorized, inspected proof capture (`proof-video` or `crowsnest-e2e`) to a PR or issue. |

## NEVER self-merge

This skill prepares a PR to merge-ready (green required CI, resolved review,
non-null `mergeable`) and hands it to a human to merge. Crowsnest review is
thin-human-review: the machine produces a verdict plus evidence, the human clicks
merge. Do not run `gh pr merge` on your own work.

## Select the scope

- Review, triage, or list: read-only. Explain the change, actionable findings,
  useful evidence, and material uncertainty. Do not edit, assign, label, comment,
  or close unless separately authorized. For queue discovery and assignment, read
  [references/triage.md](references/triage.md).
- Fix only: investigate, repair locally, and validate. Publishing still requires
  land or equivalent scoped authority.
- Land: finish the authorized scope through current-source proof, review, green
  CI on the exact head, and an open, merge-ready PR that a human merges. Read
  [references/landing.md](references/landing.md). Routine steps need no repeated
  permission; security, schema, product, and release gates remain.

The lead stays hands-on. Use bounded independent workers only where they add
useful evidence; serialize shared checkout, ref mutations, and GitHub writes.
Preserve a stalled worker's patches, claims, and proof before taking over.

## Inspect the actual item

Start with `git status -sb`; preserve unrelated changes. PR source comes from
`gh pr view/diff` and the checkout, not web search.

```bash
gh pr view <pr> --repo Kaiships-ai/crowsnest \
  --json number,title,state,body,author,assignees,baseRefName,headRefName,headRefOid,files,comments,reviews
gh issue view <issue> --repo Kaiships-ai/crowsnest \
  --json number,title,state,body,author,assignees,comments
```

Check assignment before deep work (see [references/triage.md](references/triage.md)).
An assignment less than six hours old is active ownership; continue only with
direction. Preserve co-assignees and never replace them without explicit
authority. Claim a named, unassigned item only under assignment or landing
authority, using the verified authenticated login.

## Establish the outcome

Read the affected owner, entry points, callers, siblings, tests, docs, history,
and current main as needed. Use gitnexus impact before editing any symbol (see
`CLAUDE.md`), and inspect dependency contracts directly when they determine
behavior. Investigate contrary evidence before defending a verdict. Do not fill
an arbitrary evidence matrix or invent a rejected alternative to satisfy a form.

- Already fixed: prove the original behavior is repaired on current main, with
  the canonical commit or PR and matching source or runnable proof. Under closure
  authority, comment that evidence and close; otherwise report it. A mitigation or
  diagnostic does not establish that the primary behavior is fixed.
- Real defect: reproduce it, repair its owning invariant, and prove the repaired
  path and affected siblings. Prefer a coherent simplification over a symptom
  guard. Size and LOC are context, not correctness gates.
- Existing useful PR: improve the editable branch rather than replacing it. If it
  cannot safely be updated, create an authorized credited replacement before
  closing the source. Never squash a contributor-owned PR after replacing its
  ancestry; use a maintainer-owned replacement.
- Uncertain or product decision: state the concrete gap. Do not merge a
  speculative repair or automatically close work as out of scope.

Choose proportional proof. Trusted development proof defaults local
(`npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`, and any
relevant `npm run e2e` or `npm run test:e2e` run). Explicit live requests,
external API contracts, and changes whose risk requires authenticated execution
keep their required proof. Never describe mocks, skipped checks, or an older head
as live evidence.

## Review and publish

Before committing or landing nontrivial code, run `autoreview` and resolve
verified actionable findings. Run gitnexus `detect_changes` before committing (see
`CLAUDE.md`). Reopen review for substantive changes or unresolved concerns, not a
patch-identical rebase or a mechanical head change. Address real human and bot
findings and explain rejected ones; bot scores do not create separate
obligations. Missing changelog is never a review finding; `packaging/CHANGELOG.md`
is release-owned.

Keep the PR body current: problem, solution, user impact, useful evidence, known
gaps, and contributor credit. Crowsnest has no
`.github/pull_request_template.md` (TODO: wire one), so use those sections
directly. Update the change's owning doc under `documents/` in the same PR, per
the `CLAUDE.md` standing rule. Use body files for shell-sensitive text and update
an existing relevant comment instead of duplicating it. For proof media, read
[references/media.md](references/media.md). For publication, CI, and the
merge-ready handoff, read [references/landing.md](references/landing.md).

For contributor credit and any introducing-commit question, read
[references/attribution.md](references/attribution.md). Ordinary review needs
preserved credit, not a history investigation. Unknown history does not
invalidate an independently demonstrated current defect.
