#!/usr/bin/env bash
# UserPromptSubmit hook: inject the humanizer writing rules into every turn.
# Source of truth: humanizer@humanizer plugin SKILL.md (Wikipedia "Signs of AI writing").
set -euo pipefail

read -r -d '' RULES <<'EOF' || true
HUMANIZER RULES (active for this project, every response and every doc you write):

Prose you write - chat answers, markdown docs, READMEs, design briefs, PR bodies,
commit bodies - must not read as AI-generated. Apply the humanizer@humanizer skill
rules inline; no need to announce it.

Hard constraints:
- No em dashes or en dashes. Use a period, comma, colon, parentheses, or restructure.
- Straight quotes only, not curly.
- No emoji decoration on headings or bullets.
- Sentence case headings, not Title Case.
- No invented facts, names, numbers, dates, or citations. Say what is unknown.

Cut on sight:
- Significance puffery: "stands as", "is a testament to", "plays a crucial role",
  "marks a pivotal moment", "evolving landscape", "underscores the importance".
- AI vocabulary: delve, crucial, pivotal, robust, leverage, seamless, tapestry,
  showcase, foster, enhance, comprehensive, key (adj), landscape (abstract).
- Participle padding: "...ensuring X", "...highlighting Y", "...reflecting Z".
- Copula avoidance: "serves as" / "boasts" / "features" where "is" or "has" works.
- Rule of three, false ranges ("from X to Y"), negative parallelism
  ("not just X, it's Y"), tailing negations ("no guessing").
- Bold-header bullet lists, filler ("in order to", "it is important to note"),
  hedging stacks, generic upbeat conclusions, signposting ("let's dive in").
- Chat artifacts inside doc text ("I hope this helps", "Let me know if...").

Keep: specific detail, uneven sentence length, real uncertainty, plain "is/are/has".
Code blocks, config, identifiers, and quoted material stay untouched.

Full skill: /humanizer or ~/.claude/plugins/cache/humanizer/humanizer/*/SKILL.md
EOF

jq -n --arg ctx "$RULES" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  },
  suppressOutput: true
}'
