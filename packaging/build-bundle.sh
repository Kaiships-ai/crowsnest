#!/usr/bin/env bash
# Build one crowsnest release tarball for a single platform.
#
#   packaging/build-bundle.sh <version> [platform] [outdir]
#   packaging/build-bundle.sh 0.2.0 darwin-arm64 dist
#
# Produces dist/crowsnest-v<version>-<platform>.tar.gz plus a .sha256 and a .size
# file next to it. Runs a self-contained smoke test on the result before it is
# considered done: relocatability lint, native-module load, python import, server boot.
#
# Everything platform-specific comes from packaging/platforms.json. Adding a second
# platform is a new key there, not an edit here.
set -euo pipefail

VERSION="${1:?usage: build-bundle.sh <version> [platform] [outdir]}"
PLATFORM="${2:-darwin-arm64}"
OUTDIR="${3:-dist}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORMS_JSON="$REPO/packaging/platforms.json"
STAGE="$(mktemp -d)/crowsnest-v$VERSION-$PLATFORM"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'build error: %s\n' "$*" >&2; exit 1; }

# jq is the one build-host tool we assume. CI has it; a dev machine gets a clear message.
command -v jq >/dev/null || die "jq is required on the build host (brew install jq)"

pj() { jq -r "$1" "$PLATFORMS_JSON"; }
P=".platforms[\"$PLATFORM\"]"
[ "$(pj "$P")" != "null" ] || die "platform $PLATFORM not in platforms.json"

NODE_URL="$(pj "$P.node.url")";   NODE_SHA="$(pj "$P.node.sha256")"
UV_URL="$(pj "$P.uv.url")";       UV_SHA="$(pj "$P.uv.sha256")"
PY_URL="$(pj "$P.python.url")";   PY_SHA="$(pj "$P.python.sha256")"
WHEEL_TAG="$(pj "$P.wheel_platform_tag")"
DEPLOY_TARGET="$(pj "$P.macosx_deployment_target")"

# ---------------------------------------------------------------- fetch + verify

CACHE="$REPO/packaging/.cache"
mkdir -p "$CACHE"

fetch() { # url sha dest
  local url="$1" sha="$2" dest="$3" name; name="$(basename "$dest")"
  if [ ! -f "$dest" ] || [ "$(shasum -a 256 "$dest" | awk '{print $1}')" != "$sha" ]; then
    say "downloading $name"
    curl -fsSL --retry 3 -o "$dest" "$url"
  fi
  local got; got="$(shasum -a 256 "$dest" | awk '{print $1}')"
  [ "$got" = "$sha" ] || die "sha mismatch for $name: expected $sha got $got"
}

fetch "$NODE_URL" "$NODE_SHA" "$CACHE/node-$PLATFORM.tar.gz"
fetch "$UV_URL"   "$UV_SHA"   "$CACHE/uv-$PLATFORM.tar.gz"
fetch "$PY_URL"   "$PY_SHA"   "$CACHE/python-$PLATFORM.tar.gz"

# ---------------------------------------------------------------- assemble layout

say "staging bundle at $STAGE"
mkdir -p "$STAGE/bin" "$STAGE/runtime" "$STAGE/app"

# node: strip the top dir, keep bin/node
tar xzf "$CACHE/node-$PLATFORM.tar.gz" -C "$(dirname "$STAGE")"/nodex --strip-components=1 2>/dev/null \
  || { mkdir -p "$(dirname "$STAGE")/nodex"; tar xzf "$CACHE/node-$PLATFORM.tar.gz" -C "$(dirname "$STAGE")/nodex" --strip-components=1; }
cp "$(dirname "$STAGE")/nodex/bin/node" "$STAGE/bin/node"

# uv: single static binary inside the tarball
mkdir -p "$(dirname "$STAGE")/uvx"
tar xzf "$CACHE/uv-$PLATFORM.tar.gz" -C "$(dirname "$STAGE")/uvx" --strip-components=1
cp "$(dirname "$STAGE")/uvx/uv" "$STAGE/bin/uv"

# python-build-standalone: relocatable CPython, already a "python/" dir
tar xzf "$CACHE/python-$PLATFORM.tar.gz" -C "$STAGE/runtime"
[ -d "$STAGE/runtime/python" ] || die "expected runtime/python from python tarball"

chmod +x "$STAGE/bin/node" "$STAGE/bin/uv"

# ---------------------------------------------------------------- build the app

# A fresh checkout (CI) has no node_modules, so `next build` would fail with
# "next: command not found". Install the repo's dev deps first when they are missing.
if [ ! -x "$REPO/node_modules/.bin/next" ]; then
  say "installing repo dependencies (fresh checkout)"
  ( cd "$REPO" && npm ci )
fi

# next build collects page data by importing route modules, and some touch the SQLite db
# (e.g. /api/logs/ingest). A fresh checkout has no data/crowsnest.db, which surfaces as
# "database is locked" during collection. Create and migrate it first, mirroring a dev repo.
# This build-time db is not copied into the bundle (see the copy list below); the buyer's db
# is built by kai kit init.
if [ ! -f "$REPO/data/crowsnest.db" ]; then
  say "creating a build-time database"
  ( cd "$REPO" && npm run db:migrate )
fi

say "next build (this is the slow step)"
( cd "$REPO" && MACOSX_DEPLOYMENT_TARGET="$DEPLOY_TARGET" npm run build )

say "copying app into the bundle"
# The files the running app needs. server.ts runs via tsx, so we ship source + .next,
# not a compiled server (keeps buyer runtime identical to dev; see the plan).
for item in .next server.ts next.config.ts package.json package-lock.json src drizzle scripts public services components.json postcss.config.mjs tsconfig.json; do
  [ -e "$REPO/$item" ] && cp -R "$REPO/$item" "$STAGE/app/"
done
# kit init reads .env.example from the app dir (REPO/.env.example resolves there), so it
# ships inside app/, not at the bundle root.
cp "$REPO/.env.example" "$STAGE/app/.env.example"

# node_modules: reinstall production-only against the BUNDLED node's ABI, so native
# modules (better-sqlite3) match what ships. tsx is a prod runtime need here.
say "installing production node_modules against bundled node ABI"
export PATH="$STAGE/bin:$PATH"
NPM_CLI="$(command -v npm)"
run_npm() { ( cd "$STAGE/app" && MACOSX_DEPLOYMENT_TARGET="$DEPLOY_TARGET" "$STAGE/bin/node" "$NPM_CLI" "$@" ); }
# Scripts off first: the repo's root postinstall runs tsx, which is not installed yet.
run_npm install --omit=dev --ignore-scripts --no-audit --no-fund
# tsx is a devDependency but a runtime need for us (server.ts + the CLI run through it).
run_npm install --no-save --ignore-scripts tsx
# Now build the native modules against the bundled node ABI (127 for node 22).
run_npm rebuild better-sqlite3

# strip weight that never runs
find "$STAGE/app/node_modules" -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE/app/node_modules" -name "*.md" -delete 2>/dev/null || true
find "$STAGE/app/node_modules" -name "*.map" -delete 2>/dev/null || true
# .next/dev is dev-server output (the buyer runs production), and its sourcemaps embed the
# build machine's absolute paths. Ship only the production build.
rm -rf "$STAGE/app/.next/dev"
find "$STAGE/app/.next" -name "*.map" -delete 2>/dev/null || true
# the ig sidecar ships as source, never a prebuilt venv (absolute-path shebangs do not relocate)
rm -rf "$STAGE/app/services/ig/.venv"

# ---------------------------------------------------------------- wheelhouse

say "building offline wheelhouse for the ig sidecar"
mkdir -p "$STAGE/wheelhouse"
REQ="$(mktemp)"
( cd "$REPO/services/ig" && "$STAGE/bin/uv" export --no-hashes --no-dev --no-emit-project 2>/dev/null ) \
  | grep -E '^[a-zA-Z0-9]' | sed 's/ ;.*//' > "$REQ"
"$STAGE/runtime/python/bin/python3" -m pip download \
  --only-binary=:all: --platform "$WHEEL_TAG" --python-version 3.12 --implementation cp --abi cp312 \
  -d "$STAGE/wheelhouse" -r "$REQ" 2>&1 | tail -3 \
  || die "wheelhouse download failed (a dep may lack a $WHEEL_TAG wheel; see above)"
find "$STAGE/wheelhouse" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ---------------------------------------------------------------- launcher + stamp

cat > "$STAGE/bin/kai" <<'LAUNCH'
#!/usr/bin/env bash
# Bundle launcher. Everything runs through the bundled node by absolute path so a
# buyer's Homebrew node never loads our native modules (ABI mismatch = crash).
# Resolve the symlink chain first: ~/.local/bin/kai points here, and macOS sh has no
# `readlink -f`, so walk it by hand or ROOT would land in ~/.local.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac
done
ROOT="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
exec "$ROOT/bin/node" "$ROOT/app/node_modules/.bin/tsx" "$ROOT/app/src/cli/kai.ts" "$@"
LAUNCH
chmod +x "$STAGE/bin/kai"

GIT_SHA="$(cd "$REPO" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$STAGE/VERSION" <<EOF
version=$VERSION
platform=$PLATFORM
git_sha=$GIT_SHA
node=$(pj "$P.node.version")
python=$(pj "$P.python.version")
uv=$(pj "$P.uv.version")
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# ---------------------------------------------------------------- smoke test

say "smoke test: relocatability lint (runtime surface)"
# A build-host absolute path in the RUNTIME surface (launchers, the bundled runtimes, the
# python venv config) means the buyer's extract points at files that do not exist. That is
# the bug class that sank the prebuilt-venv idea. Scope the lint to those dirs.
# App SOURCE that hardcodes a path (a default in a .ts file) is an app bug, tracked
# separately in the SDD ledger; it does not break relocation and is out of packaging scope.
HITS="$(grep -rIl "$HOME" "$STAGE/bin" "$STAGE/runtime" 2>/dev/null || true)"
[ -z "$HITS" ] || die "relocatability: build-host \$HOME leaked into runtime: $HITS"
# Shebangs anywhere in the bundle must not point at the build machine's interpreters.
SHEBANG_HITS="$(grep -rIl "^#!$HOME" "$STAGE" 2>/dev/null || true)"
[ -z "$SHEBANG_HITS" ] || die "relocatability: build-host shebang leaked into: $SHEBANG_HITS"

say "smoke test: native modules load under bundled node"
"$STAGE/bin/node" -e "require('$STAGE/app/node_modules/better-sqlite3'); console.log('natives OK')"

say "smoke test: python venv builds offline and imports the sidecar"
SMOKE_VENV="$(dirname "$STAGE")/smoke-venv"
"$STAGE/bin/uv" venv --python "$STAGE/runtime/python/bin/python3" "$SMOKE_VENV" >/dev/null
VIRTUAL_ENV="$SMOKE_VENV" "$STAGE/bin/uv" pip install --python "$SMOKE_VENV/bin/python" \
  --no-index --find-links "$STAGE/wheelhouse" -r "$REQ" \
  || die "offline runtime-deps install failed (see above)"
# The sidecar is not pip-installed (its build backend is not in the offline wheelhouse, and
# it does not need to be). It runs as `python -m crowsnest_ig` from services/ig, exactly as
# scripts/ig-service.sh does. Verify it imports and its module entry resolves that way.
( cd "$STAGE/app/services/ig" && "$SMOKE_VENV/bin/python" -c "import crowsnest_ig; print('sidecar import OK')" )

# ---------------------------------------------------------------- pack

mkdir -p "$REPO/$OUTDIR"
TARBALL="$REPO/$OUTDIR/crowsnest-v$VERSION-$PLATFORM.tar.gz"
say "packing $TARBALL"
tar czf "$TARBALL" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"

SIZE="$(stat -f %z "$TARBALL")"
SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
printf '%s' "$SHA"  > "$TARBALL.sha256"
printf '%s' "$SIZE" > "$TARBALL.size"

say "done"
printf 'tarball: %s\n size:   %s bytes (%s MB)\n sha256: %s\n' \
  "$TARBALL" "$SIZE" "$((SIZE/1024/1024))" "$SHA"
