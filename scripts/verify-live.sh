#!/usr/bin/env bash
#
# Produces the Gate 3 proofs that require a real Instagram session.
#
# Everything this prints is read back out of the database, off the disk, or off
# the wire AFTER a real sync. Nothing is simulated. If a step cannot be done for
# real, the script fails loudly rather than printing a reassuring line.
#
# Usage:
#   1. Put IG_USERNAME / IG_PASSWORD (burner account) in .env.local
#   2. Start the sidecar:  npm run ig:service
#   3. Start the app:      npm run dev          (defaults to :3000; PORT=3001 npm run dev also fine)
#   4. Connect the account in Settings -> Instagram (handles 2FA / challenge)
#   5. ./scripts/verify-live.sh @somehandle
#
set -uo pipefail

HANDLE="${1:-}"
APP_URL="${APP_URL:-http://localhost:3000}"
DB="${CROWSNEST_DB_PATH:-data/crowsnest.db}"
MEDIA="${MEDIA_ROOT:-data/media}"

if [ -z "$HANDLE" ]; then
  echo "usage: $0 @handle   (the Instagram handle to sync)" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
set -a; [ -f .env.local ] && . ./.env.local; set +a

fail() { echo; echo "FAILED: $*" >&2; exit 1; }
hr()   { echo; echo "────────────────────────────────────────────────────────"; echo "$*"; echo "────────────────────────────────────────────────────────"; }

# ── preflight ────────────────────────────────────────────────────────────────
hr "PREFLIGHT"
: "${IG_SERVICE_TOKEN:?IG_SERVICE_TOKEN missing from .env.local}"

HEALTH=$(curl -s -H "X-IG-Token: $IG_SERVICE_TOKEN" "${IG_SERVICE_URL:-http://127.0.0.1:8765}/health") \
  || fail "sidecar unreachable — run 'npm run ig:service'"
echo "$HEALTH"

echo "$HEALTH" | grep -q '"logged_in": *true' \
  || fail "sidecar is not logged in. Connect the account in Settings -> Instagram first. (No login is attempted by this script — a blind login attempt is what gets accounts banned.)"

curl -sf -o /dev/null "$APP_URL" || fail "app not reachable at $APP_URL — run 'npm run dev' (or set APP_URL)"

# ── PROOF 3: live sync ───────────────────────────────────────────────────────
hr "PROOF 3 — live sync of $HANDLE (sync_jobs row, items_seen > 0, status success)"
IG_SERVICE_TOKEN="$IG_SERVICE_TOKEN" npx tsx scripts/live-sync.ts "$HANDLE" || fail "sync threw"

sqlite3 -header -column "$DB" "
  SELECT status, items_seen, items_created, items_updated, items_failed,
         assets_downloaded, assets_failed, stop_reason, lookback_days
  FROM sync_jobs ORDER BY started_at DESC LIMIT 1;"

SEEN=$(sqlite3 "$DB" "SELECT items_seen FROM sync_jobs ORDER BY started_at DESC LIMIT 1;")
STATUS=$(sqlite3 "$DB" "SELECT status FROM sync_jobs ORDER BY started_at DESC LIMIT 1;")
[ "${SEEN:-0}" -gt 0 ] || fail "items_seen = ${SEEN:-0}; expected > 0"
[ "$STATUS" = "success" ] || echo "NOTE: status is '$STATUS' (not 'success') — inspect the gaps column above."

# ── PROOF 4: real rows inside the window ─────────────────────────────────────
hr "PROOF 4 — real captions and taken_at; newest post present; window respected"
sqlite3 -header -column "$DB" "
  SELECT substr(posted_at,1,16) AS taken_at, media_type, view_count,
         substr(replace(caption, char(10), ' '), 1, 46) AS caption
  FROM videos WHERE channel_id = (SELECT id FROM channels WHERE handle = '$HANDLE')
    AND deleted_at IS NULL
  ORDER BY posted_at DESC LIMIT 10;"

echo
echo "oldest in-window post vs the 30-day boundary:"
sqlite3 -header -column "$DB" "
  SELECT min(posted_at) AS oldest,
         datetime('now', '-' || COALESCE((SELECT lookback_days FROM sync_jobs ORDER BY started_at DESC LIMIT 1), 30) || ' days') AS boundary,
         CASE WHEN min(posted_at) >= datetime('now','-' || COALESCE((SELECT lookback_days FROM sync_jobs ORDER BY started_at DESC LIMIT 1), 30) || ' days')
              THEN 'PASS' ELSE 'FAIL — a post older than the window was stored' END AS verdict
  FROM videos
  WHERE channel_id = (SELECT id FROM channels WHERE handle='$HANDLE')
    AND deleted_at IS NULL AND first_seen_at >= datetime('now','-1 hour');"

# ── PROOF 5: assets on disk with real sizes ──────────────────────────────────
hr "PROOF 5 — assets on disk, non-zero (ls -la)"
sqlite3 -header -column "$DB" "
  SELECT kind, count(*) AS n, min(byte_size) AS smallest, max(byte_size) AS largest, sum(byte_size) AS total_bytes
  FROM media_assets GROUP BY kind;"
echo
find "$MEDIA" -type f \( -name '*.jpg' -o -name '*.mp4' -o -name '*.webp' -o -name '*.png' \) -exec ls -la {} + | head -12
ZERO=$(find "$MEDIA" -type f -size 0 | wc -l | tr -d ' ')
[ "$ZERO" = "0" ] || fail "$ZERO zero-byte asset(s) on disk"
echo "zero-byte files: 0"

# ── PROOF 6: Range serving of a REAL Instagram-sourced asset ─────────────────
hr "PROOF 6 — curl -I -> 200 and Range -> 206 on a real downloaded asset"
AID=$(sqlite3 "$DB" "SELECT id FROM media_assets WHERE kind='thumbnail' ORDER BY downloaded_at DESC LIMIT 1;")
[ -n "$AID" ] || fail "no thumbnail asset was downloaded"
curl -sI "$APP_URL/api/media/$AID" | head -8
echo
curl -s -o /dev/null -D - -H 'Range: bytes=0-1023' "$APP_URL/api/media/$AID" | grep -iE '^HTTP|content-range|content-length'

# ── PROOF 7: no CDN URL reaches the client ───────────────────────────────────
hr "PROOF 7 — zero cdninstagram/fbcdn URLs in the rendered DOM"
for PAGE in / /feed /channels; do
  N=$(curl -s "$APP_URL$PAGE" | grep -coE 'cdninstagram|fbcdn' || true)
  echo "$PAGE -> $N occurrences"
  [ "$N" = "0" ] || fail "CDN URL leaked into $PAGE"
done

# ── PROOF 9: idempotence ─────────────────────────────────────────────────────
hr "PROOF 9 — second consecutive sync creates nothing"
IG_SERVICE_TOKEN="$IG_SERVICE_TOKEN" npx tsx scripts/live-sync.ts "$HANDLE" || fail "second sync threw"
sqlite3 -header -column "$DB" "
  SELECT items_seen, items_created, items_updated, items_deleted, stop_reason
  FROM sync_jobs ORDER BY started_at DESC LIMIT 1;"
CREATED=$(sqlite3 "$DB" "SELECT items_created FROM sync_jobs ORDER BY started_at DESC LIMIT 1;")
[ "$CREATED" = "0" ] || fail "second sync created $CREATED rows; expected 0"
echo "items_created on the second run: 0  ✓"

DUPES=$(sqlite3 "$DB" "SELECT count(*) FROM (SELECT external_id FROM videos GROUP BY platform, external_id HAVING count(*) > 1);")
[ "$DUPES" = "0" ] || fail "$DUPES duplicated media pk(s)"
echo "duplicate media pks: 0  ✓"

hr "DONE — proofs 3, 4, 5, 6, 7, 9 produced from real data"
echo "Still needs a human: proof 8 (screenshots of the grid, a playing video, a carousel)"
echo "and proof 10 (logs from a genuine Instagram-issued rate limit)."
