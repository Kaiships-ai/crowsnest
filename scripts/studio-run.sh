#!/usr/bin/env bash
# studio-run.sh <command...> -- runs a command inside studio/ under the node major its
# package.json engines pins, through heavy.sh, with vitest capped at 2 workers. On node 22
# about 116 Orca tests fail for no reason but the runtime.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: studio-run.sh <command...>" >&2; exit 2; }

root="$(cd "$(dirname "$0")/.." && pwd)"
major="$(sed -n '/"engines"/,/}/s/.*"node": *"\([0-9]*\).*/\1/p' "$root/studio/package.json")"
bin="/opt/homebrew/opt/node@$major/bin"
"$bin/node" -v 2>/dev/null | grep -q "^v$major\." ||
  { echo "studio-run: node $major is missing or does not start at $bin (brew install node@$major)" >&2; exit 1; }
export PATH="$bin:$PATH"

case " $* " in *" vitest "* | " pnpm test "* | " pnpm run test "*) set -- "$@" --maxWorkers=2 ;; esac

cd "$root/studio"
# The app itself stays open for hours; holding the machine-wide heavy lock that long would
# stall every other agent's build, so `pnpm dev` only gets the node pin.
[ "$1 ${2:-}" = "pnpm dev" ] && exec "$@"
exec bash "$root/scripts/heavy.sh" "$@"
