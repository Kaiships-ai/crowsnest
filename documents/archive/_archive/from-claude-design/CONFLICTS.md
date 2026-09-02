# Where the two design specs disagree

Read before writing any CSS. `uploads/crowsnest-design-system.md` is Kai's own document and opens by
saying it is law, not a suggestion. `HANDOFF.md` is what Claude Design produced against `UI-BRIEF.md`.
They agree on the mood and disagree on eight specifics.

| Decision             | Your design system doc     | Claude Design HANDOFF.md     | Verdict          |
|----------------------|----------------------------|------------------------------|------------------|
| Background           | #0B0B0C                    | #0d0c0c                      | near identical, take either |
| Amber                | #E8A33D                    | #f5a524                      | different hex, pick one |
| Radius               | 2px on button/input/badge  | 0 everywhere                 | conflict         |
| Amber as --primary   | forbidden, budget 1 area   | yes, --primary is amber      | conflict         |
| Nav active           | raised bg, never amber     | not specified                | law doc wins     |
| Type steps           | 32/20/15/13/11 only        | 10 steps, up to 64px         | conflict         |
| Table row height     | 56px fixed                 | density="compact" 32px       | conflict         |
| Max content width    | 1440px, left aligned       | no max-width at all          | conflict         |
| Word for the ratio   | score                      | multiplier                   | conflict         |
| Word for a post      | post                       | post / video mixed           | law doc wins     |
| Word for the python  | local service              | sidecar                      | law doc wins     |
| Green                | forbidden                  | not used                     | agree            |
| Gradient / shadow    | forbidden                  | flat fills only              | agree            |
| Missing value        | not specified              | em dash, never zero          | handoff wins     |
