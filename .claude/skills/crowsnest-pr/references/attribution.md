# Author and regression attribution

Read this when the user asks who wrote something, when contributor identity or
history matters to a concrete trust decision, or when assigning a regression to
an introducing commit. Ordinary review needs contributor identity and preserved
credit, not a contribution-history investigation.

## Commit trailer convention

Crowsnest commits carry attribution as trailers, not in the subject line. An
agent-authored commit ends with the session trailers:

```text
Co-Authored-By: <Claude model> <noreply@anthropic.com>
Claude-Session: <session URL>
```

Preserve a human contributor's credit with a `Co-Authored-By:` trailer that uses
their real name and a public email: the address from their PR commit, or their
GitHub `noreply` identity (`<id>+<login>@users.noreply.github.com`). Never invent
a name or email, and never substitute the chat user's name for the verified
PR or issue author login.

## Contributor context

Use the verified PR or issue author login. Fetch profile metadata once if useful:

```bash
gh api users/<login> --jq '{login,name,created_at,type}'
```

TODO: wire a `scripts/github-activity.sh` helper if GitHub-wide contribution
history is ever needed routinely; crowsnest has none, so pull per-item activity
with narrow `gh api` calls and do not run a broad history sweep by default.
Missing, cached, or failed queries are not zero activity; private visibility may
affect totals. Activity is context, not evidence that a patch is correct.

## Introducing-commit claims

`git log -S/-G`, blame, and linked PRs find candidates; they do not prove who
introduced a defect. Inspect raw parents and compare the implicated behavior:

```bash
git --no-replace-objects cat-file -p <candidate-sha>
git --no-replace-objects diff --no-ext-diff --no-textconv \
  <raw-parent> <candidate-sha> -- <path>
```

A shallow or grafted boundary is not a root commit. Missing parent objects or an
unverifiable patch means unknown attribution, not an invented introducing SHA.
Distinguish code author, PR author, merger, committer, and current PR owner.
Report the confidence and the narrow claim the evidence supports; do not infer
introduction from dates, roles, or a maintainer's involvement. Unknown history
does not invalidate an independently demonstrated current defect.
