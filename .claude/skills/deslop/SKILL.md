---
name: deslop
description: Diff-scoped AI-slop cleanup pass. Strip comment slop, defensive-check slop, type-laundering, and style drift from the current branch diff before review. Trigger:/deslop
---

# Deslop

Clean only the current branch diff before review. Preserve behavior absolutely.

## Checklist

1. Scope the pass to `git diff` against `origin/main`, or the branch merge base when it differs (`git merge-base HEAD origin/main`). Never run a repo-wide cleanup.
2. Inspect every changed hunk for:
   - comments a human maintainer would not write: narration, syntax explanation, and prose that merely restates the code. In TypeScript, a `// increment the counter` above `count++`, a `// React component` above a component, a JSDoc block that repeats the type signature already in the params.
   - defensive checks or `try`/`catch` blocks that are abnormal for the surrounding module or guard only imagined states: a null guard on a value the type system already proves non-null, a `try`/`catch` that swallows and rethrows, an `if (!x) return` where every caller passes `x`.
   - casts that launder types, especially `as any`, `as unknown as T`, and widen-then-assert flows. Prefer a real type or a narrowing check. `npm run typecheck` and `npm run lint` should stay green after removal.
   - redundant intermediate variables or one-use helpers that do not add domain meaning, reduce duplication, or simplify control flow (`const result = foo(); return result;`).
   - compatibility shims, aliases, retries, and fallback branches without a named shipped contract and removal plan.
   - naming, control flow, imports, formatting, and other style that conflicts with the surrounding file. Match the file, not your defaults.
3. Make no functional edits. If cleanup could change behavior, leave it alone and report it instead.
4. Fix a finding inline only when the cleanup is trivial and behavior-neutral. Otherwise note it for the author.
5. Report the result in 1 to 3 sentences, including whether anything changed and any non-trivial item left for review.

Run `/deslop` before the review gate (`verification-before-completion`, or a `code-review` pass), never instead of it. The review gate remains the required correctness and safety check.
