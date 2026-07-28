<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Writing rules

Every answer and every doc in this repo follows the humanizer rules (the
`humanizer@humanizer` plugin skill, based on Wikipedia "Signs of AI writing").
Two hooks enforce this: `.claude/hooks/humanizer-context.sh` injects the rules
on each prompt, and `.claude/hooks/humanizer-doc-check.sh` blocks writes to
`.md`, `.mdx`, `.markdown`, and `.txt` files that contain em dashes, en dashes,
or curly quotes.

Applies to prose only. Code, config, identifiers, and quoted material are left
alone. Run `/humanizer` on a file to rewrite it in place.
