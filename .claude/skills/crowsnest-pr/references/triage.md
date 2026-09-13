# Triage, assignment, and closure

Use for queue discovery, related-item research, assignment decisions, and
explicitly authorized labels or closures on `Kaiships-ai/crowsnest`. Keep
review and list requests read-only.

## Discovery

Discover with narrow `gh` queries against the live repository; crowsnest has no
local archive or enrichment cache, so `gh` is the source of truth. Search title
and body first, then comments when context warrants it. A textual similarity
never proves duplication or closure eligibility.

```bash
gh issue list --repo Kaiships-ai/crowsnest --state open \
  --json number,title,labels,assignees,createdAt
gh pr list --repo Kaiships-ai/crowsnest --state open \
  --json number,title,author,createdAt,isDraft,mergeable
```

The `05-backlog-to-enhance.md` doc per component and `scripts/next-bug.sh` (which
feeds `crowsnest-fix-backlog-item`) are the in-repo backlog; the GitHub queue is
separate. For a requested count, return only qualified items and disclose an
exhausted search rather than padding. Favor concrete current bugs with an
understood owner and feasible proof. If the request is for small fixes, exclude
feature and product choices and unclear or broad ownership changes. Do not equate
a short diff with low risk.

## Assignment

Before deep work on a named item, inspect current assignees. Another assignment
less than six hours old is active ownership; continue only with direction to do
so. Older assignments are an ownership hint, not a silent veto. If assignment
time cannot be verified, say it is unknown. Preserve co-assignees and never
replace them without explicit authority. Claim a named, unassigned item only
under assignment or landing authority, using the verified authenticated login.

## Labels and closes

Read the current label set before any mutation; verify the actual label rather
than inventing one. For a proven fixed issue or superseded PR, verify current
main provides the same or better behavior: inspect the original symptom and
affected surfaces, preserve unique evidence, then comment the canonical fix and
proof before an authorized close. A mitigation or diagnostic does not establish
that the primary behavior is fixed. Keep uncertain or actively held work open.

Product rejection and out-of-scope decisions remain maintainer judgment. Under an
explicit close scope, handle the directly associated cluster consistently and
state the rationale, the supported alternative, and the evidence that would
warrant reopening. Do not close an entire neighborhood from a keyword, and do not
broaden a vague instruction into mass closures. Stop if ownership, evidence,
source trust, or authorization is uncertain.
