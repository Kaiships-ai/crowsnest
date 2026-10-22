#!/usr/bin/env bash
# Copies this worktree's data/verify/evidence into the main checkout under
# data/verify/evidence/<branch>/, so proof outlives the worktree. No-op in the main checkout.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
HERE="$(pwd -P)"
MAIN="$(cd "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" && pwd -P)"
SRC=data/verify/evidence
if [ "$HERE" = "$MAIN" ]; then
  echo "verify: main checkout, evidence already in $SRC/"
  exit 0
fi
[ -d "$SRC" ] || { echo "verify: no evidence to keep"; exit 0; }
BRANCH="$(git branch --show-current)"
DEST="$MAIN/data/verify/evidence/${BRANCH//\//-}"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
echo "verify: evidence copied to $DEST/"
