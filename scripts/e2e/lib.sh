#!/usr/bin/env bash
# Shared helpers for the browse-e2e journey scripts (scripts/e2e/<component>-<id>.sh).
# Sourced, never executed directly: `source "$(dirname "$0")/lib.sh"`.
#
# Not a test framework -- there is deliberately no assertion DSL, no page-object layer,
# no fixture registry. Just enough shell so each journey script reads the way
# references/browse-e2e-qa.md says a journey should: go here, do this, see that.
set -euo pipefail

# Resolves the `browse` CLI binary the same way the gstack browse skill's own preamble
# does (SKILL.md): prefer a copy vendored under this repo's .claude/skills, fall back to
# the user's home install. This repo does not vendor gstack, so this resolves to the
# home install in practice.
_E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -x "$_E2E_ROOT/.claude/skills/gstack/browse/dist/browse" ]; then
  BROWSE="$_E2E_ROOT/.claude/skills/gstack/browse/dist/browse"
else
  BROWSE="$HOME/.claude/skills/gstack/browse/dist/browse"
fi
[ -x "$BROWSE" ] || { echo "e2e: browse CLI not found at $BROWSE (see ~/.claude/skills/gstack/browse/SKILL.md)" >&2; exit 1; }

BASE_URL="${BASE_URL:-http://localhost:3001}"

# assert_text <substring> -- fails the journey if the current page's cleaned text
# does not contain <substring>. This is `browse text`'s own untrusted-content wrapper
# stripped by grep, not raw HTML, so it reads the same thing a person looking at the
# screen would.
assert_text() {
  local needle="$1" page
  page="$("$BROWSE" text)"
  if ! grep -qF -- "$needle" <<<"$page"; then
    echo "ASSERT FAILED: expected page text to contain: $needle" >&2
    echo "--- page text ---" >&2
    echo "$page" >&2
    exit 1
  fi
  echo "  ok: page text contains \"$needle\""
}

# assert_url_contains <substring> -- fails the journey if the current URL does not
# carry <substring> (a query param, a path segment). Polls briefly first: a client-side
# navigation (a Next.js Link, router.push) does not always land inside the window
# `browse wait --networkidle` covers -- the URL can still be mid-transition a moment
# after the click that started it.
assert_url_contains() {
  local needle="$1" url=""
  for _ in $(seq 1 20); do
    url="$("$BROWSE" url)"
    [[ "$url" == *"$needle"* ]] && break
    sleep 0.2
  done
  if [[ "$url" != *"$needle"* ]]; then
    echo "ASSERT FAILED: expected URL to contain \"$needle\", got: $url" >&2
    exit 1
  fi
  echo "  ok: URL contains \"$needle\" ($url)"
}

# select_option_by_text <visible label> -- clicks a base-ui Select option in an
# already-open listbox by its visible text. filter-bar.tsx's score/views/timeframe
# selects render each option as a `[data-slot="select-item"]` node with no per-item
# data-testid (each dropdown only needs "does an option with this label exist and pick
# it", never "the second one" or "the one matching X" -- the data-testid discipline in
# references/browse-e2e-qa.md treats that as fine for a shared testid, and here there is
# not even a shared testid to reuse, only the base-ui slot the component library always
# emits). This is the text-selector exception the discipline calls out, not the default.
# <visible label> is a fixed literal at every call site in this repo -- never untrusted
# input -- so it is embedded directly into the JS string; do not call this with anything
# that isn't a hardcoded label.
select_option_by_text() {
  local label="$1" js_file
  # browse's `eval` command only accepts a path under /tmp or the current working
  # directory -- macOS's $TMPDIR (what `mktemp` uses by default) is neither, so this
  # writes directly under /tmp rather than relying on mktemp's default.
  js_file="/tmp/e2e-select-$$-$RANDOM.js"
  trap 'rm -f "$js_file"' RETURN
  cat >"$js_file" <<JS
const label = "${label}";
const el = [...document.querySelectorAll('[data-slot="select-item"]')].find(
  (o) => o.textContent.trim() === label
);
if (!el) throw new Error("no select-item with text " + JSON.stringify(label));
el.click();
JS
  "$BROWSE" eval "$js_file" >/dev/null
}

step() { printf '\n[%s] %s\n' "$(basename "$0" .sh)" "$*"; }

# snap <name> -- capture a screenshot of the current page as the evidence the 4b
# test gate's screenshot mandate (references/browse-e2e-qa.md) asks for. Run it
# at the frame that proves Expected. By default it writes straight into the
# component's test-shots folder -- the exact path the 4b gate embeds in the case's
# 04 Result cell -- derived from the journey filename (feed-e2e-01 -> feed), so
# there is no manual move between running the journey and citing its shot. Set
# SNAP_DIR to override (e.g. a scratch dir in a smoke test).
#
# It is evidence, never an assertion: the assert_* calls prove the run, so a
# capture that fails must not fail the journey -- best-effort, its own failure is
# a warning, not an exit.
snap() {
  local name="$1" journey comp dir out
  journey="$(basename "$0" .sh)"      # feed-e2e-01
  comp="${journey%-e2e-*}"           # feed
  dir="${SNAP_DIR:-documents/architect/core-components/$comp/test-shots}"
  mkdir -p "$dir"
  out="$dir/${journey}-${name}.png"
  if "$BROWSE" screenshot "$out" >/dev/null 2>&1; then
    echo "  shot: $out"
  else
    echo "  shot: failed to capture $out (non-fatal, evidence only)" >&2
  fi
}

# goto_and_settle <url> -- navigates and waits for the page to finish loading and
# settle. Next's dev server briefly double-renders a fresh route on first paint (a
# streaming/hydration artifact, not a real duplicate in the shipped tree) -- a `browse
# click`/`wait` against a testid queried in that split second can hit "matched multiple
# elements" even though there is exactly one of that element a moment later. Routing
# every journey's Arrive step through this instead of a bare `goto` avoids that race.
goto_and_settle() {
  "$BROWSE" goto "$1"
  "$BROWSE" wait --networkidle
  sleep 0.3
}
