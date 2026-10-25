#!/usr/bin/env bash
# retire.sh <worktree-path> -- run from outside the worktree; after the branch's PR merged: stop its verify server, copy its
# evidence to the main checkout, then remove the worktree and its local branch.
# Refuses the main checkout, a worktree with uncommitted changes, and an unmerged branch.
set -euo pipefail
WT="$(cd "${1:?usage: retire.sh <worktree-path>, run from outside it}" && git rev-parse --show-toplevel)"
MAIN="$(cd "$(dirname "$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)")" && pwd -P)"
[ "$(cd "$WT" && pwd -P)" != "$MAIN" ] || { echo "verify: $WT is the main checkout, not a worktree" >&2; exit 1; }
BRANCH="$(git -C "$WT" branch --show-current)"
[ -z "$(git -C "$WT" status --porcelain)" ] || { echo "verify: $WT has uncommitted changes, not removing it" >&2; exit 1; }
STATE="$(cd "$WT" && gh pr view "$BRANCH" --json state -q .state 2>/dev/null || true)"
if [ "$STATE" != MERGED ]; then
  git -C "$WT" fetch -q origin
  git -C "$WT" merge-base --is-ancestor HEAD origin/main \
    || { echo "verify: $BRANCH is not merged (PR state: ${STATE:-none}), not removing it" >&2; exit 1; }
fi
B="$HOME/.claude/skills/gstack/browse/dist/browse"
if [ -d "$WT/.gstack/browse-cwd" ] && [ -x "$B" ]; then (cd "$WT/.gstack/browse-cwd" && "$B" stop >/dev/null 2>&1) || true; fi
HELD="$(lsof -a -d cwd -Fpn 2>/dev/null | awk '/^p/{p=substr($0,2)} /^n/{print "pid " p ": " substr($0,2)}' | grep -F "$WT" || true)"
[ -z "$HELD" ] || { printf 'verify: processes still run inside %s, stop them first:\n%s\n' "$WT" "$HELD" >&2; exit 1; }
# An Electron helper or daemon can hold the worktree through its command line, not its cwd. List them and stop.
STRAY="$(pgrep -fl -- "$WT(/| |\$)" | grep -v 'retire\.sh' | grep -vE "^($$|$PPID) " || true)"
[ -z "$STRAY" ] || { printf 'verify: processes started from %s still run, stop them first:\n%s\n' "$WT" "$STRAY" >&2; exit 1; }
# Nested worktrees agents made under this worktree, or under a scratchpad folder named exactly after it. Dirty ones are kept.
NAME="$(basename "$WT")"
git -C "$MAIN" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' \
  | { grep -E -- "^$WT/|/[^/]*-$NAME/" || true; } | while read -r NESTED; do
    if [ -z "$(git -C "$NESTED" status --porcelain 2>/dev/null)" ]; then
      git -C "$MAIN" worktree remove "$NESTED" && echo "verify: removed nested worktree $NESTED"
    else
      echo "verify: kept nested worktree $NESTED, it has uncommitted changes" >&2
    fi
  done
S="$WT/.claude/skills/verify/scripts"
if [ -x "$S/app-down.sh" ]; then "$S/app-down.sh"; fi
if [ -x "$S/keep-evidence.sh" ]; then "$S/keep-evidence.sh"; else
  [ -d "$WT/data/verify/evidence" ] && mkdir -p "$MAIN/data/verify/evidence/${BRANCH//\//-}" \
    && cp -R "$WT/data/verify/evidence/." "$MAIN/data/verify/evidence/${BRANCH//\//-}/"
fi
git -C "$MAIN" worktree remove --force "$WT"
git -C "$MAIN" branch -D "$BRANCH" >/dev/null 2>&1 || true
echo "verify: removed worktree $WT and branch $BRANCH"
