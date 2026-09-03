# Ground with GitNexus (shared workflow step)

A code-knowledge-graph pass that replaces broad Grep/Read with targeted graph
queries, so an agent builds context in hundreds of tokens instead of reading
whole files. Use it at the read-heavy, against-already-committed-code steps.
It is a navigation layer, not a source of truth: it tells you where to look and
what connects to what; the current source is what you verify against and edit.

## When this applies

Use this before an agent would otherwise read wide swaths of `src/` to
understand structure, flows, callers, or what a change touched:
- research and concept mapping,
- building a module-structure table or dependency map,
- finding what a shipped diff actually changed (doc-sync),
- a caller / blast-radius sweep for a plan.

Do NOT use it as the authority for an edit, and do NOT wire it into a
fast per-task implement loop where the code changes between tasks and the
index goes stale (see "Staleness").

## Procedure

1. **Bind the repo.** Call `list_repos {}` once. Many repos are indexed here,
   so pass `repo: "crowsnest"` on EVERY gitnexus call. An omitted `repo` with
   multiple repos indexed errors or silently resolves to a default, so never
   omit it.
2. **Check freshness.** Primary method, always available to a sub-agent: read
   the `crowsnest` entry from `list_repos {}` and compare its `indexedAt` /
   `lastCommit` against `git rev-parse HEAD`. If the commit matches (or the
   entry carries no staleness flag), the graph is fresh. Only if they diverge,
   refresh with `npx gitnexus analyze . --force --skip-agents-md` (writes the
   `.gitnexus` index; `--skip-agents-md` keeps it from re-dirtying AGENTS.md /
   CLAUDE.md). The `gitnexus://repo/crowsnest/context` resource carries the same
   staleness data if your client can read MCP resources, but do not depend on
   it: many sub-agents only have the MCP tools, not resource reads.
3. **Query the graph for the named question**, then stop. Match the task to the
   right gitnexus skill and follow it rather than re-deriving:
   - Understand a flow / architecture -> `gitnexus-exploring`
     (`query`, `context`, `clusters`, the `process/{name}` resource).
   - What a change touched / blast radius -> `gitnexus-impact-analysis`
     (`impact`, `detect_changes`).
   - A specific symbol's callers/callees/refs -> `context {name, repo}`.
   Each query answers one written-down question; do not dredge.
4. **Read only the specific files you will edit or must verify.** The graph
   narrows the read set; it does not remove the read of what you change.

## Load-bearing caveats

- **Worktree (`detect_changes`).** When you run from a linked worktree the MCP
  server was not launched from (this repo's builds run under
  `.claude/worktrees/...`), pass `worktree: "<abs worktree path>"` to
  `detect_changes`. Without it, `git diff` runs in the wrong checkout and
  reports ZERO changed symbols: a false clean that carries no degradation flag.
  Prefer feeding the agent the real `git diff <base>..<head>` alongside the
  graph result rather than trusting a bare `detect_changes` from a worktree.
- **Source beats graph.** The graph can lag the tree. Verify any symbol you
  will modify, or assert as current fact in a doc, against live source.
  Comments are the weakest evidence.
- **No embeddings here.** The crowsnest index has `embeddings: 0`, so `query`
  is structural, not semantic: phrase queries as concepts that map to real
  symbol/flow names, and fall back to `context`/`cypher` when a concept search
  comes back thin.
- **Drizzle tables read as empty.** `impact`/`context` on a table symbol (a
  Drizzle `Const` like `scripts` in `schema.ts`) commonly returns
  `impactedCount: 0` with a risk note, because table constants carry no
  read/write edges in this index. That zero is NOT "unused" -- it is a blind
  spot. When the change touches a table, get its real readers and writers with
  `grep -rn "tables\.<name>" src`, not from the graph. Query `impact` on the
  service functions around the table instead (they do have call edges).
- **Ledger, do not repeat.** Record each graph question and its answer; never
  re-run the same query or re-read an unchanged range in the same task.
- **Doc-sync is git-first.** For a Phase 5b doc-sync, the authority for "what
  changed" is `git diff <base>..<head>` and `git log` (route moves, renames,
  and backlog-status changes live in git and the docs, not in the code graph).
  Drive from the diff; use `context`/`impact` to expand a hunk into its callers
  and blast radius. Do not lean on `detect_changes` as the primary source,
  especially from a worktree (see the worktree caveat above).
