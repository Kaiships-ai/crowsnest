#!/usr/bin/env bash
# PreToolUse hook on Write|Edit: block prose files that carry hard AI tells.
# Only the deterministic tells are enforced here (dashes, curly quotes).
# The judgment calls live in humanizer-context.sh.
set -euo pipefail

INPUT=$(cat)

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE" in
  *.md|*.mdx|*.markdown|*.txt) ;;
  *) exit 0 ;;
esac

CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""')
[ -n "$CONTENT" ] || exit 0

TELLS=""
printf '%s' "$CONTENT" | grep -q '—' && TELLS="${TELLS}em dash (—), " || true
printf '%s' "$CONTENT" | grep -q '–' && TELLS="${TELLS}en dash (–), " || true
printf '%s' "$CONTENT" | grep -q '[“”]' && TELLS="${TELLS}curly double quotes, " || true
printf '%s' "$CONTENT" | grep -q '[‘’]' && TELLS="${TELLS}curly single quotes, " || true

[ -n "$TELLS" ] || exit 0

REASON="humanizer: this doc contains ${TELLS%, }. Replace each one (period, comma, colon, parentheses, or restructure; straight quotes) and write the file again. Also re-check the prose for the other tells in the humanizer rules before retrying."

jq -n --arg r "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
