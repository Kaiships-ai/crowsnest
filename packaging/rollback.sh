#!/usr/bin/env bash
# Roll a crowsnest release back to a version that was already uploaded to R2.
# Re-points install.sh and latest.json at that version's tarball; does not touch
# git, does not rebuild anything, and does not re-upload the tarball itself.
#   packaging/rollback.sh <version> [platform]
#
# Prereqs (same as release.sh): wrangler login; TOKEN_SECRET already deployed.
set -euo pipefail
VERSION="${1:?usage: rollback.sh <version> [platform]}"
PLATFORM="${2:-darwin-arm64}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="crowsnest-releases"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler is required (run from packaging/worker, or npm i -g wrangler)" >&2
  exit 1
fi

mkdir -p "$REPO/dist"
TARBALL="$REPO/dist/crowsnest-v$VERSION-$PLATFORM.tar.gz"
OBJ="releases/v$VERSION/crowsnest-v$VERSION-$PLATFORM.tar.gz"

echo "==> fetching v$VERSION-$PLATFORM from R2 ($BUCKET/$OBJ)"
wrangler r2 object get "$BUCKET/$OBJ" --file "$TARBALL" \
  || { echo "no release object at $OBJ -- check the version and platform, and that it was ever released." >&2; exit 1; }

echo "==> generating install.sh for v$VERSION"
bash "$REPO/packaging/gen-install.sh" "$VERSION" "$TARBALL" > "$REPO/dist/install.sh"

echo "==> re-uploading install.sh + latest.json (rollback to v$VERSION)"
wrangler r2 object put "$BUCKET/install.sh" --file "$REPO/dist/install.sh" --content-type text/x-shellscript
printf '{"version":"%s"}' "$VERSION" > "$REPO/dist/latest.json"
wrangler r2 object put "$BUCKET/latest.json" --file "$REPO/dist/latest.json" --content-type application/json

echo "==> done. buyers get v$VERSION on their next install or \`kai update\`."
echo "    the v$VERSION tarball was not re-uploaded -- it was already at $OBJ. only the pointer moved."
