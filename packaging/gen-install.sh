#!/usr/bin/env bash
# Bake a release's version, checksum, size, and disk requirement into install.sh.
#   packaging/gen-install.sh <version> <tarball> > dist/install.sh
set -euo pipefail
VERSION="${1:?usage: gen-install.sh <version> <tarball>}"
TARBALL="${2:?usage: gen-install.sh <version> <tarball>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

SIZE="$(cat "$TARBALL.size" 2>/dev/null || stat -f %z "$TARBALL")"
SHA="$(cat "$TARBALL.sha256" 2>/dev/null || shasum -a 256 "$TARBALL" | awk '{print $1}')"
# tarball is compressed; extracted app + venv roughly triples it. Require 3x + 300MB slack.
REQUIRED_MB=$(( SIZE/1024/1024*3 + 300 ))

sed -e "s|__VERSION__|$VERSION|g" \
    -e "s|__SHA256__|$SHA|g" \
    -e "s|__SIZE__|$SIZE|g" \
    -e "s|__REQUIRED_MB__|$REQUIRED_MB|g" \
    "$REPO/packaging/install.sh.template"
