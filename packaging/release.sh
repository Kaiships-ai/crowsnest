#!/usr/bin/env bash
# Cut a crowsnest release: build the bundle, bake install.sh, upload everything to R2.
#   packaging/release.sh <version> [platform]
#
# Prereqs (one time): wrangler login; wrangler r2 bucket create crowsnest-releases;
#   cd packaging/worker && wrangler secret put TOKEN_SECRET && npm run deploy
set -euo pipefail
VERSION="${1:?usage: release.sh <version> [platform]}"
PLATFORM="${2:-darwin-arm64}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="crowsnest-releases"

TARBALL="$REPO/dist/crowsnest-v$VERSION-$PLATFORM.tar.gz"

# Refuse to cut a release with no changelog entry: the version buyers get must be documented.
grep -q "^## $VERSION\$" "$REPO/packaging/CHANGELOG.md" \
  || { echo "no CHANGELOG.md entry for $VERSION. Add a '## $VERSION' section first."; exit 1; }

echo "==> building the bundle"
bash "$REPO/packaging/build-bundle.sh" "$VERSION" "$PLATFORM" dist

echo "==> generating install.sh"
bash "$REPO/packaging/gen-install.sh" "$VERSION" "$TARBALL" > "$REPO/dist/install.sh"

echo "==> uploading to R2 ($BUCKET)"
OBJ="releases/v$VERSION/crowsnest-v$VERSION-$PLATFORM.tar.gz"
wrangler r2 object put "$BUCKET/$OBJ" --file "$TARBALL" --content-type application/gzip
wrangler r2 object put "$BUCKET/install.sh" --file "$REPO/dist/install.sh" --content-type text/x-shellscript
printf '{"version":"%s"}' "$VERSION" > "$REPO/dist/latest.json"
wrangler r2 object put "$BUCKET/latest.json" --file "$REPO/dist/latest.json" --content-type application/json

echo "==> done. buyers install with:"
echo "   curl -fsSL https://<your-worker-domain>/install.sh | sh"
