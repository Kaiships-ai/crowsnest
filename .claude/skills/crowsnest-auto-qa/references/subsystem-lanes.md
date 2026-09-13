# Current-source subsystem lanes

Freeze `origin/main` before starting a wave. Identify the actual canonical main
checkout rather than assuming a worktree's `HEAD` is current. Verify each
read-only worker checkout with the exact `git -C <checkout> rev-parse HEAD` and
an empty `git -C <checkout> status --porcelain=v1` before inspection and again
immediately before accepting its report. Do not treat an intentionally dirty fix
worktree as a frozen reviewer checkout. Let only the lead refresh the shared
remote ref. Inspect root `AGENTS.md`, `CLAUDE.md`, the owning
`documents/architect/core-components/<name>` docs, owner boundaries, tests,
callers, and sibling implementations. File locations are discovery starting
points, not a claim that a particular file, route, or symbol still exists.

## The eleven component lanes

Crowsnest has eleven core components under
`documents/architect/core-components/`. Each is one materially different lane;
split a large one into narrower leaf tasks rather than giving one worker the
whole app.

1. **analyze:** the scoring and analysis path that ranks videos; input
   contracts, the scoring output, and the surfaces that read it. See
   `core-components/analyze`.
2. **discover:** channel discovery and follow flows (`channels`,
   `channels/discover`, `channels/[channelId]`), empty and error states. See
   `core-components/discover`.
3. **feed:** `src/app/(shell)/feed`, filters, the scoring bar, card to detail
   (`feed/[videoId]`), remix entry, empty and error states. See
   `core-components/feed`.
4. **ig-sync:** the Instagram sidecar and sync path, session auth, 2FA and
   challenge handling, rate handling, `scripts/verify-live.sh` proof. See
   `core-components/ig-sync`.
5. **kit:** packaging, install, gate, and release of the paid Kit
   (`scripts/release-prep.sh`, `packaging/`). See `core-components/kit`.
6. **llm:** the model-call path and its data-action brain boundary; prompt
   assembly, response handling, and the surfaces that consume it. See
   `core-components/llm` and `shared/data-action-brain.md`.
7. **mcp:** the MCP tool surface and its deterministic data/action brain; tool
   contracts and error responses. See `core-components/mcp` and
   `shared/mcp-tool-reference.md`.
8. **mine:** `src/app/(shell)/(loaded)/mine`, calendar tabs, planning a post,
   own-channel state, grid rendering. See `core-components/mine`.
9. **onboarding:** first run (`src/app/first-run`), the app shell, navigation,
   loading and error boundaries. See `core-components/onboarding` and
   `shared/navigation-and-shell.md`.
10. **publish:** the planned-post publish path (`scripts/publish-evidence.ts`
    grounds its proof), Graph token auth, dry-run versus live media publish. See
    `core-components/publish`.
11. **remix:** the remix generation flow from a source video to a planned post.
    See `core-components/remix`.

Cross-cutting surfaces (`documents/architect/shared/`) belong to whichever lane
owns the behavior under test: the data layer (drizzle schema, migrations via
`npm run db:migrate`, backups via `scripts/backup-db.ts`), API route contracts
(`src/app/api/*`), background jobs, and persistence. Do not manufacture findings
by dividing one defect into multiple lanes.

## Read-only reviewer prompt

Give each read-only reviewer a narrow prompt equivalent to:

> At frozen crowsnest main `<full-sha>`, independently audit `<one component
> lane>` for real current-main correctness regressions. Read root `AGENTS.md`,
> `CLAUDE.md`, the owning `documents/architect/core-components/<name>` docs, the
> module, entry point, callers, callees, sibling paths, state lifecycle, tests,
> and direct dependency source where relevant. Do not modify files, run heavy
> tests, print secrets, touch the operator's dev server or real database
> (`data/crowsnest.db`), touch a live Instagram session, or assume another
> reviewer's conclusion. Return only concrete current-main defects with
> repo-root paths, a user-path reproduction, the canonical root cause, all
> affected siblings, a coherent owner-boundary refactor, an authentic
> regression, duplicates, and a low-risk versus review-required classification.
> Count a shared invariant once. Return no verified bug if the evidence is
> insufficient.

Keep reviewers read-only and reserve writable isolated worktrees for authorized
fixers (see `using-git-worktrees`). Count only independently observed, still
running workers toward active lanes; report completed and stale-baseline outputs
separately. When independent reviewers are unavailable, inspect the lanes
sequentially and report the concurrency limitation honestly.
