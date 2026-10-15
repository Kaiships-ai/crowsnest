#!/usr/bin/env bash
# plan-status.sh: the lego board, generated on demand (never committed).
#
# Prints one row per component: open backlog items and active plans touching it.
# Reads documents/plans/*.md frontmatter and each component's 05-backlog-to-enhance.md.
# No arguments.
set -uo pipefail
cd "$(dirname "$0")/.."

DOCS="documents"
PLANS="$DOCS/plans"
COMPS="$DOCS/architect/core-components"

hr() { printf '\n%s\n' "----------------------------------------------------------------"; }

hr; printf 'crowsnest lego board  (generated %s)\n' "$(date +%Y-%m-%d)"; hr

printf '%-14s %-14s %s\n' "COMPONENT" "OPEN BACKLOG" "ACTIVE PLANS"
for d in "$COMPS"/*/; do
  [ -d "$d" ] || continue
  c="$(basename "$d")"
  bl="$d/05-backlog-to-enhance.md"
  # open backlog = table rows whose last cell is "open"
  open=0
  [ -f "$bl" ] && open="$(grep -c "| open |$" "$bl" 2>/dev/null; true)"
  # active plans naming this component in frontmatter components: [...]
  plans=0
  if [ -d "$PLANS" ]; then
    plans="$(grep -lE "^components:.*\b${c}\b" "$PLANS"/*.md 2>/dev/null \
      | xargs -I{} grep -l '^status: active' {} 2>/dev/null | wc -l | tr -d ' ')"
  fi
  printf '%-14s %-14s %s\n' "$c" "$open" "$plans"
done

# shared backlog too
sbl="$DOCS/architect/shared/backlog-to-enhance.md"
if [ -f "$sbl" ]; then
  sopen="$(grep -c '| open |$' "$sbl" 2>/dev/null)"; sopen="${sopen:-0}"
  printf '%-14s %-14s %s\n' "shared" "$sopen" "-"
fi

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
