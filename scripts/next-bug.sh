#!/usr/bin/env bash
# next-bug.sh: the open bug boards, sorted to the top one to fix next.
#
# Reads every documents/architect/core-components/*/05-backlog-to-enhance.md
# plus documents/architect/shared/backlog-to-enhance.md. Prints every row
# whose Type is "bug" and Status is "open", sorted blocker > high > medium >
# low. A row whose title links a plan (a markdown link, e.g. "[foo](bar.md)")
# is excluded: that work is already tracked by a plan, not a free-standing fix.
#
# One line per item: component ID severity verify source title
#
# verify is a heuristic, not a fact from the row: "browse" when the source
# names a .tsx file or the title reads like a rendering bug (shows/renders/
# overlay); "vitest" otherwise. Override the filter, not the heuristic, with:
#
#   --verify vitest|browse   print only rows matching that verify method
#
# The first line printed is the next bug to fix.
set -uo pipefail
cd "$(dirname "$0")/.."

VERIFY_FILTER=""
if [ "${1:-}" = "--verify" ]; then
  VERIFY_FILTER="${2:-}"
  case "$VERIFY_FILTER" in
    vitest|browse) ;;
    *) echo "usage: $0 [--verify vitest|browse]" >&2; exit 1 ;;
  esac
fi

COMPS="documents/architect/core-components"
SHARED="documents/architect/shared/backlog-to-enhance.md"

rows() {
  local file="$1" component="$2"
  awk -F'|' -v component="$component" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    NF < 7 { next }
    {
      id = trim($2); title = trim($3); severity = trim($4); type = trim($5)
      source = trim($6); status = trim($7)
    }
    id == "ID" || id ~ /^[-:]+$/ { next }
    type != "bug" { next }
    status != "open" { next }
    title ~ /\[[^]]*\]\([^)]*\)/ { next }
    {
      rank = 0
      if (severity == "blocker") rank = 4
      else if (severity == "high") rank = 3
      else if (severity == "medium") rank = 2
      else if (severity == "low") rank = 1

      verify = "vitest"
      if (source ~ /\.tsx/ || title ~ /shows|renders|overlay/) verify = "browse"

      printf "%d\t%s\t%s\t%s\t%s\t%s\t%s\n", rank, component, id, severity, verify, source, title
    }
  ' "$file"
}

{
  for d in "$COMPS"/*/; do
    [ -d "$d" ] || continue
    c="$(basename "$d")"
    f="${d}05-backlog-to-enhance.md"
    [ -f "$f" ] && rows "$f" "$c"
  done
  [ -f "$SHARED" ] && rows "$SHARED" "shared"
} | sort -t "$(printf '\t')" -k1,1nr -k2,2 -k3,3 \
  | awk -F'\t' -v filter="$VERIFY_FILTER" '
      filter != "" && $5 != filter { next }
      { printf "%-12s %-8s %-8s %-7s %-30s %s\n", $2, $3, $4, $5, $6, $7 }
    '
