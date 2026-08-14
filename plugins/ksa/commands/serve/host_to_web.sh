#!/usr/bin/env bash
# host_to_web.sh - publish carousel JPEGs to the kaiships website public folder
# and deploy, so the Instagram API can fetch them by public URL.
#
# Usage: host_to_web.sh <slug> <image1.jpg> [image2.jpg ...]
# Prints the public HTTPS URLs (one per line, in order) on success.
#
# Deploy mechanism: this site is a Vercel-linked project (.vercel/ present, NO git
# remote), so it deploys via the Vercel CLI, not git push.
#
# Requirement: Vercel CLI must be authenticated - either `vercel login` once, or
# set VERCEL_TOKEN in the environment. If not, the deploy step errors clearly.
#
# Config (override via env):
#   IG_WEB_REPO      path to the website repo (default below)
#   IG_WEB_BASE_URL  public base URL of the site (default the Vercel subdomain)
set -euo pipefail

WEB_REPO="${IG_WEB_REPO:-/Users/kienbeovl/Desktop/entrepreneur/kai-ships-ai-website}"
BASE_URL="${IG_WEB_BASE_URL:-https://kai-ships-ai-website.vercel.app}"

slug="${1:?need a slug}"; shift
[ "$#" -ge 1 ] || { echo "need at least one image" >&2; exit 1; }

dest="$WEB_REPO/public/ig/$slug"
mkdir -p "$dest"
# Clear any stale files for this slug (e.g. a prior carousel run) so a Reel's
# .mp4 does not sit next to a leftover slideN.jpg with the wrong content-type.
rm -f "$dest"/slide*

urls=()
i=1
for f in "$@"; do
  [ -f "$f" ] || { echo "missing file: $f" >&2; exit 1; }
  # Preserve the source extension so content-type is correct: a Reel's video.mp4
  # must be served as .mp4 (video/mp4), not renamed to .jpg. The prior hardcoded
  # slideN.jpg broke the Reel path (IG rejects an mp4 served as image/jpeg).
  ext="${f##*.}"
  cp "$f" "$dest/slide${i}.${ext}"
  urls+=("$BASE_URL/ig/$slug/slide${i}.${ext}")
  i=$((i+1))
done

# Deploy to production via Vercel CLI (uses npx so a global install is not required).
# Honors VERCEL_TOKEN if set; otherwise relies on `vercel login` session.
token_arg=()
[ -n "${VERCEL_TOKEN:-}" ] && token_arg=(--token "$VERCEL_TOKEN")
( cd "$WEB_REPO" && npx --yes vercel deploy --prod --yes ${token_arg[@]+"${token_arg[@]}"} >/dev/null ) \
  || { echo "vercel deploy failed - is the CLI authenticated (vercel login / VERCEL_TOKEN)?" >&2; exit 1; }

# Wait for the new files to be live: poll each URL until HTTP 200 (max ~3 min).
for url in "${urls[@]}"; do
  code=""
  for _ in $(seq 1 36); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
    [ "$code" = "200" ] && break
    sleep 5
  done
  [ "$code" = "200" ] || { echo "URL not live after wait: $url (last=$code)" >&2; exit 1; }
done

printf '%s\n' "${urls[@]}"
