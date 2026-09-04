#!/usr/bin/env bash
# B-17 regression check: a missing videoId on /feed/[videoId] must return HTTP 404.
#
# This is a status-code assertion that only a real HTTP response can make (Next.js
# commits the status while streaming), so it runs against a running server rather than
# vitest. Point it at a dev or prod server; the bad-id check needs no seeded data.
#
#   npm run build && PORT=3000 npm run start &   # or npm run dev
#   bash scripts/check-videodetail-404.sh 3000
#
# Exits non-zero if a missing video returns anything but 404 (the B-17 bug: it returned
# 200 because an ancestor loading.tsx boundary flushed the shell before notFound ran).
set -uo pipefail
PORT="${1:-3000}"
BASE="http://localhost:${PORT}"

code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/feed/b17-missing-video-check")
echo "GET /feed/b17-missing-video-check -> ${code} (want 404)"
if [ "$code" = "404" ]; then
  echo "PASS: a missing videoId returns 404"
  exit 0
fi
echo "FAIL: a missing videoId returned ${code}, not 404 (B-17 regression - check the (shell) loading boundary does not wrap /feed/[videoId])"
exit 1
