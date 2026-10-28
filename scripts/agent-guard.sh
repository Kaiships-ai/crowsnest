#!/usr/bin/env bash
# Claude Code PreToolUse hook for Bash (.claude/settings.json). Off CI it refuses the heavy commands an
# agent can type around scripts/heavy.sh: a direct tsc, vitest, oxlint or electron-vite build. Builders in
# PR 242 ran `tsc --noEmit -p config/tsconfig.crowsnest.json` twice although the rule said CI runs it.
[ "${CI:-}" = true ] && exit 0
cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(`]) *([A-Z_]+=[^ ]* +)*(npx +|pnpm +exec +|node_modules/\.bin/)?(tsc|vitest|oxlint)( |$)|(^|[;&|(`]) *([A-Z_]+=[^ ]* +)*(npx +|pnpm +exec +|node_modules/\.bin/)?electron-vite +build'; then
  echo "agent-guard: refused off CI: '$cmd'. CI runs typecheck, lint and tests after you push. Locally prove behavior with the verify journeys in dev mode (APP_DEV=1), plus at most one test file: pnpm test --project <project> <file>.test.ts" >&2
  exit 2
fi
exit 0
