#!/usr/bin/env bash
# Prep a crowsnest release: bump the version, write the CHANGELOG section, run
# the test gate, commit, and tag. Does NOT push -- it prints the push command
# and stops, so a human reviews the commit before it goes anywhere.
#
#   scripts/release-prep.sh <version>
#   scripts/release-prep.sh 0.3.0
#
# After this exits, review `git show HEAD` and `git log -1`, then run the
# printed `git push` line yourself.
set -euo pipefail

VERSION="${1:?usage: release-prep.sh <version>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'release-prep error: %s\n' "$*" >&2; exit 1; }

# Ask a yes/no question. Never blocks a non-interactive run: with no terminal to
# read from, it answers "no" and says so, rather than hanging CI forever.
confirm() {
  local prompt="$1" ans=""
  if [ -t 0 ]; then
    read -r -p "$prompt [y/N] " ans
  elif [ -e /dev/tty ]; then
    read -r -p "$prompt [y/N] " ans </dev/tty
  else
    echo "   (no terminal to prompt; skipping: $prompt)"
    return 1
  fi
  case "$ans" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------- guards

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH', not main. Switch to main first."

[ -z "$(git status --porcelain)" ] || die "working tree is dirty. Commit or stash first."

command -v npm >/dev/null || die "npm is required"

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
LOG_START="${LAST_TAG:-$(git rev-list --max-parents=0 HEAD | tail -1)}"

# ---------------------------------------------------------------- version bump

say "bumping version to $VERSION"
npm version "$VERSION" --no-git-tag-version >/dev/null
# npm accepts aliases too (patch/minor/major); read back what it actually wrote.
VERSION="$(node -p "require('./package.json').version")"

# ---------------------------------------------------------------- changelog

say "updating packaging/CHANGELOG.md"
CHANGELOG="$REPO/packaging/CHANGELOG.md"
[ -f "$CHANGELOG" ] || die "packaging/CHANGELOG.md not found"

if grep -q "^## $VERSION\$" "$CHANGELOG"; then
  die "packaging/CHANGELOG.md already has a ## $VERSION section"
fi

if [ -n "$LAST_TAG" ]; then
  LOG_ENTRIES="$(git log --oneline "$LAST_TAG"..HEAD)"
else
  LOG_ENTRIES="$(git log --oneline)"
fi
[ -n "$LOG_ENTRIES" ] || LOG_ENTRIES="(no commits since ${LAST_TAG:-the beginning})"

# Insert the new section right above the first existing "## " heading, so the
# file's title and intro paragraph stay put and every older entry survives untouched.
FIRST_HEADING="$(grep -n '^## ' "$CHANGELOG" | head -1 | cut -d: -f1 || true)"
FIRST_HEADING="${FIRST_HEADING:-$(($(wc -l <"$CHANGELOG") + 1))}"

TMP_CHANGELOG="$(mktemp)"
{
  head -n "$((FIRST_HEADING - 1))" "$CHANGELOG"
  echo "## $VERSION"
  echo
  while IFS= read -r line; do
    [ -n "$line" ] && echo "- $line"
  done <<<"$LOG_ENTRIES"
  echo
  tail -n +"$FIRST_HEADING" "$CHANGELOG"
} >"$TMP_CHANGELOG"
mv "$TMP_CHANGELOG" "$CHANGELOG"

# ---------------------------------------------------------------- test gate

say "running the test gate (npm test)"
npm test

if [ -f "$REPO/scripts/e2e/run.sh" ]; then
  if confirm "scripts/e2e/run.sh exists. Run \`npm run e2e\` before releasing?"; then
    npm run e2e
  else
    echo "   skipping e2e"
  fi
fi

IG_CHANGED="$(git diff --name-only "$LOG_START"..HEAD -- services/ig src/server/ig 2>/dev/null || true)"
if [ -n "$IG_CHANGED" ]; then
  echo
  echo "services/ig or src/server/ig changed since ${LAST_TAG:-the first commit}:"
  echo "$IG_CHANGED" | sed 's/^/     /'
  if confirm "Run \`npm run verify:live\` against a real Instagram account before releasing?"; then
    npm run verify:live
  else
    echo "   skipping verify:live -- make sure this was verified against a live account by hand."
  fi
fi

# ---------------------------------------------------------------- commit + tag

say "committing and tagging v$VERSION"
git add -A
git commit -m "release: v$VERSION" >/dev/null
git tag "v$VERSION"

say "ready. review the commit, then push it yourself:"
echo
echo "   git push origin main v$VERSION"
echo
