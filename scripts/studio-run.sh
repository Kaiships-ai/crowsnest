#!/usr/bin/env bash
# studio-run.sh [--no-lock] <command...> -- runs a command inside studio/ under the node major
# its package.json engines pins, through heavy.sh (skipped with --no-lock, for the app itself),
# with vitest capped at 2 workers.
set -euo pipefail
lock=1
[ "${1:-}" = --no-lock ] && { lock=0; shift; }
[ $# -gt 0 ] || { echo "usage: studio-run.sh [--no-lock] <command...>" >&2; exit 2; }

root="$(cd "$(dirname "$0")/.." && pwd)"
major="$(sed -n '/"engines"/,/}/s/.*"node": *"\([0-9]*\).*/\1/p' "$root/studio/package.json")"
bin="/opt/homebrew/opt/node@$major/bin"
"$bin/node" -v 2>/dev/null | grep -q "^v$major\." ||
  { echo "studio-run: node $major is missing or does not start at $bin (brew install node@$major)" >&2; exit 1; }
export PATH="$bin:$PATH"

case " $* " in *" vitest "* | " pnpm test "* | " pnpm run test "*) set -- "$@" --maxWorkers=2 ;; esac

cd "$root/studio"
[ "$lock" = 1 ] || exec "$@"
exec bash "$root/scripts/heavy.sh" "$@"
