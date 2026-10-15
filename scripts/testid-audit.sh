#!/usr/bin/env bash
# testid-audit.sh: report data-testid values named in the e2e case
# docs that do not yet exist under src/. The browse-e2e coverage mandate writes
# coverage cases before their testids are built (each gap filed as a GitHub issue
# labeled backlog), so a missing id is expected debt, not drift: it is reported as a warning,
# not a failure. Set TESTID_AUDIT_STRICT=1 to fail on any miss instead.
set -uo pipefail
cd "$(dirname "$0")/.."

DOCS="scripts/e2e/cases"

ids="$(grep -rho 'data-testid="[^"]*"' "$DOCS"/*.md 2>/dev/null \
  | sed -E 's/^data-testid="(.*)"$/\1/' | sort -u)"

if [ -z "$ids" ]; then
  echo "OK: 0 ids all present"
  exit 0
fi

missing=()
count=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  count=$((count + 1))
  grep -rq -- "$id" src/ || missing+=("$id")
done <<< "$ids"

if [ "${#missing[@]}" -gt 0 ]; then
  echo "WARNING: ${#missing[@]} of $count data-testid(s) referenced in docs are not yet in src/ (pending testid backfill, tracked as GitHub backlog issues):"
  printf '  %s\n' "${missing[@]}"
  if [ "${TESTID_AUDIT_STRICT:-0}" = "1" ]; then
    echo "TESTID_AUDIT_STRICT=1 set, treating missing ids as a failure."
    exit 1
  fi
  exit 0
fi

echo "OK: $count ids all present"
