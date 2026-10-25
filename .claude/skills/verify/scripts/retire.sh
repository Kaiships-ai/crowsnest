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
# An Electron helper or daemon can hold the worktree through its command line, not its cwd.
STRAY="$(pgrep -fl -- "$WT" | grep -v 'retire\.sh' | awk '{print $1}' | grep -vx -e "$$" -e "$PPID" || true)"
if [ -n "$STRAY" ]; then
  echo "verify: stopping processes started from $WT: $(echo $STRAY)"
  kill $STRAY 2>/dev/null || true; sleep 2; kill -9 $STRAY 2>/dev/null || true
fi
# ponytail: nested worktrees are found by the worktree's folder name in their path; agents put them in scratchpads named after it.
git -C "$MAIN" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | grep -F -- "$(basename "$WT")" | grep -vx -- "$WT" \
  | while read -r NESTED; do git -C "$MAIN" worktree remove --force "$NESTED" && echo "verify: removed nested worktree $NESTED"; done
S="$WT/.claude/skills/verify/scripts"
if [ -x "$S/down.sh" ]; then "$S/down.sh"; fi
if [ -x "$S/keep-evidence.sh" ]; then "$S/keep-evidence.sh"; else
  [ -d "$WT/data/verify/evidence" ] && mkdir -p "$MAIN/data/verify/evidence/${BRANCH//\//-}" \
    && cp -R "$WT/data/verify/evidence/." "$MAIN/data/verify/evidence/${BRANCH//\//-}/"
fi
git -C "$MAIN" worktree remove --force "$WT"
git -C "$MAIN" branch -D "$BRANCH" >/dev/null 2>&1 || true
echo "verify: removed worktree $WT and branch $BRANCH"
