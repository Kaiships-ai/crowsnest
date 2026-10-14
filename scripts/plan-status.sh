#!/usr/bin/env bash
# plan-status.sh: the lego board, generated on demand (never committed).
#
# Prints one row per component: open backlog items and active plans touching it.
# Reads documents/plans/*.md frontmatter; open backlog counts come from GitHub issues (label backlog).
# No arguments.
set -uo pipefail
cd "$(dirname "$0")/.."

DOCS="documents"
PLANS="$DOCS/plans"
COMPS="scripts/e2e/cases"

hr() { printf '\n%s\n' "----------------------------------------------------------------"; }

hr; printf 'crowsnest lego board  (generated %s)\n' "$(date +%Y-%m-%d)"; hr

printf '%-14s %-14s %s\n' "COMPONENT" "OPEN BACKLOG" "ACTIVE PLANS"
for d in "$COMPS"/*.md; do
  c="$(basename "$d" .md)"
  [ "$c" = shared ] && continue
  open="$(gh issue list --label backlog --label "area:$c" --json number --jq length 2>/dev/null || echo "?")"
  # active plans naming this component in frontmatter components: [...]
  plans=0
  if [ -d "$PLANS" ]; then
    plans="$(grep -lE "^components:.*\b${c}\b" "$PLANS"/*.md 2>/dev/null \
      | xargs -I{} grep -l '^status: active' {} 2>/dev/null | wc -l | tr -d ' ')"
  fi
  printf '%-14s %-14s %s\n' "$c" "$open" "$plans"
done

printf '%-14s %-14s %s\n' shared "$(gh issue list --label backlog --label area:shared --json number --jq length 2>/dev/null || echo "?")" "-"

hr
printf 'Active plans:\n'
if [ -d "$PLANS" ] && ls "$PLANS"/*.md >/dev/null 2>&1; then
  for p in "$PLANS"/*.md; do
    st="$(sed -n 's/^status:[[:space:]]*//p' "$p" | head -1)"
    [ "$st" = "active" ] || continue
    cs="$(sed -n 's/^components:[[:space:]]*//p' "$p" | head -1)"
    printf '  %s  %s\n' "$(basename "$p")" "$cs"
  done
else
  printf '  (none yet)\n'
fi
hr
