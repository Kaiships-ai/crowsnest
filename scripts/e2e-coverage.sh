#!/usr/bin/env bash
# e2e-coverage.sh <component-name> -- the mechanical half of a component's
# browse-e2e coverage gate, so the "grep-able facts, not judgment calls"
# in that gate are actually grepped instead of eyeballed.
#
# Reads a component's scripts/e2e/cases/<c>.md: its built-feature table and
# its browse-e2e table and prints the coverage record the 4b
# gate asks for. Two tiers, deliberately:
#
#   HARD FAIL (exit 1) -- the unambiguous, mechanical shortfalls that are always
#   the author's to fix: an offline browse-e2e row whose Script is `none` or
#   points at a file that does not exist, or an offline row whose Result cell is
#   still blank / "not run". These fire only when the row already exists, so a
#   component mid-backfill is never failed for rows it has not written yet.
#
#   WARN (exit 0, flagged) -- shortfalls with a legitimate escape hatch the
#   script cannot see: a built feature with no journey (may be a deliberate
#   incremental backfill, tracked as a test-coverage backlog row) and fewer than
#   five distinct corner-case types (a "not applicable" note per missing type is
#   allowed and lives in prose). These are surfaced for the human, not enforced,
#   because enforcing them would fail the 9-of-11 components that are still
#   backfilling (see references/test-cases-format.md "Migration").
#
# Usage:  scripts/e2e-coverage.sh feed
#         scripts/e2e-coverage.sh --all      # every component, summary + exit 1 if any hard-fails
set -uo pipefail
cd "$(dirname "$0")/.."

CASES="scripts/e2e/cases"
CORNER_MIN="${E2E_COV_CORNER_MIN:-5}"

usage() { echo "usage: $0 <component-name> | --all" >&2; exit 2; }

# check_one <component> -- prints the coverage record, returns 1 on a hard fail.
check_one() {
  local comp="$1"
  local f03="$CASES/$comp.md"
  local f04="$f03"

  if [ ! -f "$f04" ]; then
    echo "[$comp] no $f04 -- skipped"
    return 0
  fi

  # Built features from 03: pipe-table rows whose # cell is numeric and whose
  # Status cell (col 4) carries a Built (●) or Partial (◐) glyph.
  local built=""
  if [ -f "$f03" ]; then
    built="$(awk -F'|' '
      function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); gsub(/`/,"",s); return s }
      NF < 7 { next }
      { num = trim($2); status = trim($5) }
      num !~ /^[0-9]+$/ { next }
      status ~ /●|◐/ { print num }
    ' "$f03" | sort -un | tr "\n" " ")"
  fi

  # The browse-e2e table inside 04: detected by its header row (contains Feat,
  # Mode, and Script). Rows are read until the first line that is not a table row.
  # Columns: | ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
  local rec
  rec="$(awk -F'|' -v CORNER_MIN="$CORNER_MIN" '
    function trim(s){ gsub(/^[ \t]+|[ \t]+$/,"",s); gsub(/`/,"",s); return s }
    # enter the browse-e2e table on its header row
    !intable && /^[ \t]*\|/ {
      hdr = $0
      if (hdr ~ /Feat/ && hdr ~ /Mode/ && hdr ~ /Script/) { intable = 1; next }
    }
    intable {
      if ($0 !~ /^[ \t]*\|/) { intable = 0; next }   # left the table
      if ($0 ~ /^[ \t]*\|[ \t:|-]+\|[ \t]*$/) next   # separator row
      id = trim($2)
      if (id == "ID" || id == "") next
      feat = trim($4); type = trim($5); mode = tolower(trim($6))
      script = trim($11); result = trim($12)

      # distinct corner-case types (any Type that is not happy)
      if (type != "" && type != "happy") corner[type] = 1

      # features covered: split Feat on commas
      n = split(feat, fs, /[ ,]+/)
      for (i = 1; i <= n; i++) if (fs[i] ~ /^[0-9]+$/) covered[fs[i]] = 1

      # hard checks apply to offline rows only (live rows can be legitimately 🟡)
      if (mode == "offline") {
        if (script == "" || script == "none") {
          hard[++h] = id " offline row has Script=" (script==""?"(blank)":script)
        } else {
          print "SCRIPTCHECK\t" id "\t" script   # existence checked in bash
        }
        if (result == "" || result ~ /not.?run/) {
          hard[++h] = id " offline row Result is not run (" (result==""?"blank":result) ")"
        }
      }
    }
    END {
      nc = 0; ctypes = ""
      for (t in corner) { nc++; ctypes = ctypes (ctypes==""?"":", ") t }
      print "CORNER\t" nc "\t" ctypes
      for (c in covered) print "COVERED\t" c
      for (i = 1; i <= h; i++) print "HARD\t" hard[i]
    }
  ' "$f04")"

  # Resolve the deferred script-existence checks in bash (awk cannot stat files).
  local hard_fail=0
  local corner_n=0 corner_types="" covered_list=""
  local -a hard_msgs=()
  while IFS=$'\t' read -r kind a b; do
    case "$kind" in
      SCRIPTCHECK) [ -f "$b" ] || { hard_msgs+=("$a script does not exist: $b"); } ;;
      CORNER) corner_n="$a"; corner_types="$b" ;;
      COVERED) covered_list="$covered_list $a" ;;
      HARD) hard_msgs+=("$a") ;;
    esac
  done <<< "$rec"

  # WARN: built features with no journey
  local missing=""
  for feat in $built; do
    case " $covered_list " in *" $feat "*) ;; *) missing="$missing $feat" ;; esac
  done

  echo "[$comp]"
  echo "  Feature paths: $(echo $built | wc -w | tr -d ' ') built, $(echo $covered_list | wc -w | tr -d ' ') covered${missing:+  WARN uncovered:$missing}"
  echo "  Corner types: ${corner_types:-none} ($corner_n distinct)${corner_types:+}"
  [ "$corner_n" -lt "$CORNER_MIN" ] && echo "  WARN: $corner_n distinct corner types, want >= $CORNER_MIN (a per-type 'not applicable' note is allowed)"
  if [ "${#hard_msgs[@]}" -gt 0 ]; then
    for m in "${hard_msgs[@]}"; do echo "  HARD FAIL: $m"; done
    hard_fail=1
  fi
  echo "  Gate: $([ "$hard_fail" -eq 0 ] && echo pass || echo FAIL)"
  return "$hard_fail"
}

[ $# -ge 1 ] || usage

if [ "$1" = "--all" ]; then
  rc=0
  for d in "$CASES"/*.md; do
    [ -f "$d" ] || continue
    [ "$(basename "$d" .md)" = shared ] && continue
    check_one "$(basename "$d" .md)" || rc=1
  done
  exit "$rc"
fi

check_one "$1"
