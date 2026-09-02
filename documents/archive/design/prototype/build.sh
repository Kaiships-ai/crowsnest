#!/usr/bin/env bash
#
# Assembles the clickable UX prototype from the shell and the four flow parts.
# Fails loudly rather than producing a half built page, because a prototype that
# silently drops a flow is worse than one that refuses to build.
#
set -uo pipefail
cd "$(dirname "$0")"

OUT="prototype.html"
TMP="$(mktemp -t crowsnest-proto)"
trap 'rm -f "$TMP"' EXIT

PARTS=(parts/01-coldstart-channels.html parts/02-feed-video.html parts/03-vault-remix.html parts/04-ownchannel-system.html)
HEADS=("Cold start and channels" "Feed and video" "Vault and remix" "Own channel and system")

missing=0
for p in "${PARTS[@]}"; do
  [ -f "$p" ] || { echo "MISSING: $p" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "build aborted, parts missing" >&2; exit 1; }

# Same style rule the repo hook enforces on docs.
if grep -l $'—\|–\|’\|“\|”' "${PARTS[@]}" 2>/dev/null; then
  echo "build aborted: em dash, en dash or curly quote found in the files above" >&2
  exit 1
fi

: > "$TMP"
for i in "${!PARTS[@]}"; do
  printf '\n<div class="group">%s</div>\n' "${HEADS[$i]}" >> "$TMP"
  cat "${PARTS[$i]}" >> "$TMP"
done

python3 - "$OUT" "$TMP" <<'PY'
import sys, io
out, bodyfile = sys.argv[1], sys.argv[2]
shell = io.open("_shell.html", encoding="utf-8").read()
if "<!--FLOWS-->" not in shell:
    raise SystemExit("shell is missing the <!--FLOWS--> marker")
body = io.open(bodyfile, encoding="utf-8").read()
io.open(out, "w", encoding="utf-8").write(shell.replace("<!--FLOWS-->", body))
PY

flows=$(grep -c '<section class="flow"' "$OUT")
screens=$(grep -o 'data-screen=' "$OUT" | wc -l | tr -d ' ')
states=$(grep -o 'data-state=' "$OUT" | wc -l | tr -d ' ')
size=$(( $(wc -c < "$OUT") / 1024 ))

echo "built $OUT"
echo "  flows:   $flows (expected 36)"
echo "  screens: $screens"
echo "  states:  $states"
echo "  size:    ${size}KB"
[ "$flows" -eq 36 ] || echo "  WARNING: flow count is not 36" >&2
