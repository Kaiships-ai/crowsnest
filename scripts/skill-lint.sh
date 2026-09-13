#!/usr/bin/env bash
# Lint every skill under .claude/skills. Fails CI on a broken skill so the
# flat skill set stays valid. Checks, per skill:
#   1. name: in frontmatter equals the folder name
#   2. frontmatter is present and closed (two --- lines)
#   3. a non-empty description: line exists
#   4. disable-model-invocation, if present, is exactly true
# Repo-wide:
#   5. no two skills share a name
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT/.claude/skills"
fail=0
names_file="$(mktemp)"
trap 'rm -f "$names_file"' EXIT

err() { echo "FAIL  $1"; fail=1; }

for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  folder="$(basename "$dir")"
  f="$dir/SKILL.md"

  if [ ! -f "$f" ]; then
    err "$folder: no SKILL.md"
    continue
  fi

  # 2. frontmatter closed
  if [ "$(grep -c '^---[[:space:]]*$' "$f")" -lt 2 ]; then
    err "$folder: frontmatter not present or not closed (need two --- lines)"
  fi

  # 1. name == folder
  name="$(awk -F': *' '/^name:/{print $2; exit}' "$f" | tr -d '\r')"
  if [ -z "$name" ]; then
    err "$folder: missing name: in frontmatter"
  elif [ "$name" != "$folder" ]; then
    err "$folder: name '$name' does not match folder"
  else
    echo "$name" >> "$names_file"
  fi

  # 3. description present and non-empty
  desc="$(awk -F'description:' '/^description:/{print $2; exit}' "$f" | tr -d '\r' | sed 's/^[[:space:]>|]*//')"
  if ! grep -qE '^description:' "$f"; then
    err "$folder: missing description:"
  fi

  # 4. disable-model-invocation must be true when present
  dmi="$(awk -F': *' '/^disable-model-invocation:/{print $2; exit}' "$f" | tr -d '\r[:space:]')"
  if [ -n "$dmi" ] && [ "$dmi" != "true" ]; then
    err "$folder: disable-model-invocation must be 'true' if set (got '$dmi')"
  fi
done

# 5. duplicate names
dups="$(sort "$names_file" | uniq -d)"
if [ -n "$dups" ]; then
  err "duplicate skill names: $(echo "$dups" | tr '\n' ' ')"
fi

count="$(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [ "$fail" -eq 0 ]; then
  echo "OK    skill-lint: $count skills valid"
else
  echo "skill-lint failed"
fi
exit "$fail"
