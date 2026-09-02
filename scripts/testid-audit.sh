#!/usr/bin/env bash
# testid-audit.sh: every data-testid named in the component test-case docs
# must actually exist somewhere under src/. Catches docs and code drifting
# apart: a test case that references an id nobody renders.
set -uo pipefail
cd "$(dirname "$0")/.."

DOCS="documents/architect/core-components"

ids="$(grep -rho 'data-testid="[^"]*"' "$DOCS"/*/04-test-cases.md 2>/dev/null \
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
  echo "MISSING: ${#missing[@]} data-testid(s) referenced in docs but not found under src/"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

echo "OK: $count ids all present"
