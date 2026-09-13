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

## Select the scope

- Review, triage, or list: read-only. Explain the change, actionable findings,
  useful evidence, and material uncertainty. Do not edit, assign, label, comment,
  or close unless separately authorized.
- Fix only: investigate, repair locally, and validate. Publishing still requires
  land or equivalent scoped authority.
- Land: finish the authorized scope through current-source proof, review,
  green CI on the exact head, and an open, merge-ready PR. Preserve contributor
  credit and unrelated work. Routine steps need no repeated permission; security,
  schema, product, and release gates remain.

NEVER self-merge. This skill prepares a PR to merge-ready (green required CI,
resolved review, non-null mergeable) and hands it to a human to merge. Crowsnest
review is thin-human-review: the machine produces a verdict plus evidence, the
human clicks merge. Do not run `gh pr merge` on your own work.

The lead stays hands-on. Use bounded independent workers only where they add
useful evidence; serialize shared checkout/ref mutations and GitHub writes.
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

Check assignment before deep work. An assignment less than six hours old is
active ownership; continue only with direction. Older assignments are an
ownership hint, not a silent veto; if age cannot be verified, say it is unknown.
Preserve co-assignees and never replace them without explicit authority. Claim a
named, unassigned item only under assignment or landing authority, using the
verified authenticated login.

## Establish the outcome

Read the affected owner, entry points, callers, siblings, tests, docs, history,
and current main as needed. Use gitnexus impact before editing any symbol (see
`CLAUDE.md`), and inspect dependency contracts directly when they determine
behavior. Investigate contrary evidence before defending a verdict. Do not fill
an arbitrary evidence matrix or invent a rejected alternative to satisfy a form.

- Already fixed: prove the original behavior is repaired on current main, with
  the canonical commit/PR and matching source or runnable proof. Under closure
  authority, comment that evidence and close; otherwise report it. A mitigation
  or diagnostic does not establish that the primary behavior is fixed.
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
relevant `scripts/e2e` run). Explicit live requests, external API contracts, and
changes whose risk requires authenticated execution keep their required proof.
Never describe mocks, skipped checks, or an older head as live evidence.

## Review and publish

Before committing or landing nontrivial code, run `$autoreview` and resolve
verified actionable findings. Run gitnexus `detect_changes` before committing (see
`CLAUDE.md`). Reopen review for substantive changes or unresolved concerns, not a
patch-identical rebase or a mechanical head change. Address real human/bot
findings and explain rejected ones; bot scores do not create separate
obligations. Missing changelog is never a review finding; `packaging/CHANGELOG.md`
is release-owned (`scripts/release-prep.sh`), and user-facing release-note context
stays in the PR body or commit.

Keep the PR body current: problem, solution, user impact, useful evidence, known
gaps, and contributor credit. (TODO: wire a `.github/pull_request_template.md`;
crowsnest has none yet, so use these sections directly.) Update its owning doc
under `documents/` in the same PR, per the `CLAUDE.md` standing rule. Explain
material tradeoffs when they matter; do not require universal LOC tables. Omit
agent transcripts unless explicitly requested. Use body files for shell-sensitive
text and update an existing relevant comment instead of duplicating it.

## Land and close out

For a main-targeted PR under landing authority:

1. Open or update the PR; verify author/committer and the authenticated writer.
   Unset ambient `GITHUB_TOKEN`/`GH_TOKEN` when they could select the wrong writer.
2. Push and confirm required CI (`.github/workflows/ci.yml`: typecheck, lint,
   vitest, `scripts/testid-audit.sh`) attaches to and passes on the exact pushed
   head. Watch one exact head; fetch failed logs once. Re-run `$autoreview` if the
   head changed substantively.
3. When CI is green, review is resolved, and GitHub reports non-null mergeable,
   mark the PR ready and report it as merge-ready with a verdict plus evidence.
   Stop there. A human merges.

Refresh or rebase only for a conflict, failing guard, explicit request, or
material stale-base risk, not merely because main advanced. A queued bot score is
not a landing gate. Do not weaken guards to accommodate missing commands.

After a merge is confirmed by someone, verify the final state and source rather
than trusting a local summary, and return the task checkout to current main.
Report the problem, owner-level change, important proof and limitations, credit,
and linked final state in concise prose. Record worthwhile follow-ups; do not
manufacture another task after a bounded request is complete.

## Attribution and provenance

Read this only when contributor identity or a regression's introducing commit
matters to a concrete decision; ordinary review needs preserved credit, not a
history investigation. Use the verified PR/issue author login, not the chat
user's name, and a public author email from the commit or its GitHub noreply
identity; never invent a name or email. Fetch profile metadata once if useful:

```bash
gh api users/<login> --jq '{login,name,created_at,type}'
```

Missing, cached, or failed queries are not zero activity, and activity is context,
not evidence a patch is correct. For introducing-commit claims, `git log -S/-G`,
blame, and linked PRs find candidates but do not prove introduction; inspect raw
parents and compare the implicated behavior, and report unknown attribution
rather than inventing a SHA. Unknown history does not invalidate an independently
demonstrated current defect.
