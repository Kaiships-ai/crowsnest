---
name: cn-design-router
description: Router for the anti-slop design skills (taste:hallmark, taste:emil-design-eng, taste:apple-design, taste:animation-vocabulary, taste:find-animation-opportunities, taste:improve-animations). Grills to pin intent, then names the single skill or the ordered combo to run. Routes only, does not design.
disable-model-invocation: true
---

# Design router

Pick the right anti-slop design skill for the job. Grill first so the route is correct, then hand off. This skill does not design or build. It routes.

The six skills it routes to:

| Skill | Does | Read-only? |
|---|---|---|
| taste:hallmark | build a new page or app, `audit` a UI for slop, `redesign` a page's look, `study` a URL or screenshot to extract its DNA | no for build/redesign, yes for audit/study |
| taste:emil-design-eng | polish a component, review UI code for craft (Before/After table) | advisory |
| taste:apple-design | build or review fluid gesture UI: drag, sheet, swipe, spring, momentum, materials, type foundations | advisory |
| taste:animation-vocabulary | name a motion effect you can describe but cannot name | yes |
| taste:find-animation-opportunities | sweep a UI for where motion belongs, reject most candidates | yes |
| taste:improve-animations | audit existing motion, emit prioritized fix plans for another agent | yes on source |

## Step 1: Grill to pin intent

Use the grilling technique: one question at a time, each with a recommended answer, until the answers select exactly one row of the route table below or one named combo. Do not route on a guess. When two rows still fit, ask the one question that separates them.

The decisive questions, in order. Stop early once the route is unambiguous.

1. New or existing? Building from scratch, or working on a UI that already exists.
2. Visual or motion? Layout, structure, type, color, or animation and interaction. Can be both.
3. Do it or plan it? Implement now, or read-only audit and plan.
4. A reference to pull from? A page or screenshot you admire and want the DNA of.
5. Scope? One component, one screen, the whole app, or the design system and its tokens.

Completion criterion: the answers map to one route row or one combo, and you can state the one-line why. If not, ask another decisive question.

## Step 2: Print the route

Print the chosen skill or ordered combo, a one-line why, and the exact invocation to run. For a combo, number the steps in run order and say what each produces for the next.

## Step 3: Hand off

On the go-ahead, invoke the first skill in the route via the Skill tool. For a combo, run them in order, carrying each skill's output into the next. Never merge two skills into one pass. Each runs on its own.

## Route table

| What you want | Route | Why |
|---|---|---|
| Build a new page, app, or landing from scratch | taste:hallmark (default flow) | greenfield anti-slop, structural variety per brief |
| Score an existing UI for slop, get a ranked punch list | taste:hallmark audit <target> | anti-pattern findings, no edits |
| Redesign an existing page's look, same routes and content | taste:hallmark redesign <target> | new visual structure in place |
| Copy the DNA of a design you admire | taste:hallmark study <url or image> | extract macrostructure, type pairing, color anchor, never pixels |
| Polish one component, review UI code for craft | taste:emil-design-eng | design-eng lens, Before/After table |
| Build fluid gesture UI: drag, sheet, swipe, spring, momentum | taste:apple-design | physical, interruptible, velocity-aware motion |
| Name a motion effect you can describe but cannot name | taste:animation-vocabulary | reverse glossary, returns the term |
| Find where a UI should animate, and where it should not | taste:find-animation-opportunities | read-only, rejects most candidates |
| Audit existing animations, get a fix roadmap | taste:improve-animations | prioritized findings plus self-contained plans |

## Combos

Named multi-skill recipes. When the grill lands on one of these, print the whole ordered chain.

Ship a new UI that also feels alive:
1. taste:hallmark (default) builds the visual structure.
2. taste:find-animation-opportunities marks the few places motion earns its keep.
3. taste:apple-design or taste:improve-animations turns those recipes into real motion.

Make an existing app feel better overall:
1. taste:hallmark audit returns the visual punch list.
2. taste:improve-animations returns the motion punch list.
3. Merge both into one prioritized list before touching code.

Finalize or enhance a design system:
This is never one skill. Grill to split it into three tracks, then route each.
- Visual tokens and structure: taste:hallmark study if you have a reference to pull from, or taste:hallmark audit to score current screens against the draft system.
- Component and polish rules: taste:emil-design-eng.
- Motion tokens (easing, duration, spring scales) and current motion debt: taste:apple-design for the scale, taste:improve-animations to audit how the app uses it today.
Fold every result into the repo's one design-system doc so it stays the single source of truth. In this repo that is docs/design/DESIGN-SYSTEM.md.

## Boundaries

Routes only. It does not build, audit, or write plans itself. When the route needs a plan before code, hand off to the skill that plans (taste:improve-animations) or to superpowers:writing-plans, not this one.
