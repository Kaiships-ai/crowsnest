---
status: active
components: [remix, persona]
backlog: none
owner: Goal 1 lead (opus) - session_01XbUniwFzh3eahwW2AMyvYH
shipped: null
---

# Remix + Persona polish (UI Wave 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the improvement board's Wave 2 items for the two Create-lane surfaces that survived the scope cut: the six-stage Remix studio (`animate` stage transitions + stepper connector; `polish` unify the generating states into one calm rhythm) and the Persona screen (`onboard` example fills + why-each-field; `clarify` enriched placeholders + a dirty-edit guard).

**Architecture:** Rendering-layer only. No new dependency: motion is CSS via the already-imported `tw-animate-css` (`animate-in`/`fade-in`/`slide-in-from-*`), which honours `prefers-reduced-motion`; durations stay <=200ms per DESIGN.md's flat/austere posture. One new shared presentational component (`GeneratingSkeleton`) collapses three near-duplicate skeleton blocks. Persona dirty state is a pure helper (`personaIsDirty`) plus a `beforeunload` guard. No server actions, schema, or data-shape changes.

**Tech Stack:** Next.js (custom `tsx server.ts`), React client components, Tailwind v4 + tw-animate-css, shadcn-style ui primitives, Vitest.

**Spec:** The improvement board (`/tmp/crowsnest-goals/improvement-board.txt`, Create section) + `DESIGN.md` (Instrument Panel) + `PRODUCT.md`. Wave-2 scope cut: all `/mine/[postId]/studio` items DROPPED (Goal 2 deletes studio).

## Global Constraints

- **Amber Law:** `--primary` (amber) only on the score readout and one primary action per screen. Banned on nav/progress/toggles/badges/connectors/skeletons. Stepper connector and generating skeletons stay neutral (`--line-strong`/`--border`/muted). Persona's one amber action is the existing Save button - nothing new may take amber. Verify per file: `grep -nE "bg-primary|text-primary|border-primary" <file>` and justify each hit.
- **Square corners:** skeletons keep `rounded-none`; radius tokens are 0 so `rounded-*` class names are not bugs - do not touch them.
- **Motion:** CSS only, no new dep; every animated element carries `motion-reduce:animate-none`; durations <=200ms.
- **No fabricated data:** copy/examples in Persona are static guidance, never presented as the user's real values; example text only fills an empty field on explicit click.
- **Next.js here is not stock:** read `node_modules/next/dist/docs/` before app-code changes; app opens at `http://localhost:3000`, never 127.0.0.1.
- **Before editing any exported symbol:** run GitNexus `impact({target, direction:"upstream"})` (MCP) or `node .gitnexus/run.cjs impact "<sym>" --direction upstream --repo <worktree>`; report callers/risk; treat UNKNOWN as unresolved (confirm with text search); warn on HIGH/CRITICAL.

---

### Task 1: Shared `GeneratingSkeleton` - one calm loading rhythm

Board (remix polish): "Unify the abrupt generating states (5-card skeleton, GroundedIn line, SteerBox) into one calm loading rhythm." Today the Hook stage renders a 5-card grid of `h-28` skeletons, Style renders 4x `h-16` stacked, Script renders a `Writing script…` label + 3x `h-40` stacked and, unlike the other two, drops the `GroundedIn` line while generating. This task extracts one component so all three share a rhythm and always keep `GroundedIn` visible above the skeletons.

**Files:**
- Create: `src/components/remix/generating-skeleton.tsx`
- Modify: `src/components/remix/stage-hook.tsx` (the `{generating ? (...grid of Skeleton...)` block, ~lines 187-193)
- Modify: `src/components/remix/stage-style.tsx` (the `{generating ? (...stack of Skeleton...)` block, ~lines 155-160)
- Modify: `src/components/remix/stage-script.tsx` (the `if (pending) { return (...) }` early-return block, ~lines 300-315)

**Interfaces:**
- Produces: `GeneratingSkeleton({ label: string; count: number; rowClassName: string; layout?: "stack" | "grid" }): JSX.Element`

- [ ] **Step 1: Create the shared component**

```tsx
// src/components/remix/generating-skeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/** One calm loading rhythm shared by the Hook, Style and Script stages (board:
 *  remix polish — "unify the abrupt generating states into one calm loading
 *  rhythm"). Each stage passes its own row count/height and an honest indeterminate
 *  label; the caller keeps the GroundedIn line rendered ABOVE this, so what fed the
 *  run stays visible the whole time it runs. tw-animate-css drives the Skeleton
 *  pulse and already honours prefers-reduced-motion, so no motion guard is needed. */
export function GeneratingSkeleton({
  label,
  count,
  rowClassName,
  layout = "stack",
}: {
  label: string;
  count: number;
  rowClassName: string;
  layout?: "stack" | "grid";
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-2xs tracking-wide text-faint uppercase">{label}</p>
      <div className={layout === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex flex-col gap-3"}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className={`${rowClassName} w-full rounded-none`} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run GitNexus impact on the three stage components before editing**

Run (in the worktree): `node .gitnexus/run.cjs impact "StageHook" --direction upstream --repo .` and likewise for `StageStyle`, `StageScript`. Expected callers: only `remix-studio.tsx`. Record the risk verdict; if UNKNOWN, confirm with `grep -rn "StageHook\|StageStyle\|StageScript" src/`. Proceed only on LOW/none.

- [ ] **Step 3: Wire into Hook stage**

In `src/components/remix/stage-hook.tsx`, add the import `import { GeneratingSkeleton } from "@/components/remix/generating-skeleton";` and replace the generating block:

```tsx
      {generating ? (
        <GeneratingSkeleton label="Generating hooks…" count={5} rowClassName="h-28" layout="grid" />
      ) : drafts.length > 0 ? (
```

Remove the now-unused `Skeleton` import from stage-hook.tsx.

- [ ] **Step 4: Wire into Style stage**

In `src/components/remix/stage-style.tsx`, add the import and replace the generating block:

```tsx
      {generating ? (
        <GeneratingSkeleton label="Generating outline…" count={4} rowClassName="h-16" />
      ) : beats.length > 0 ? (
```

Remove the now-unused `Skeleton` import from stage-style.tsx.

- [ ] **Step 5: Wire into Script stage and restore GroundedIn while generating**

In `src/components/remix/stage-script.tsx`, add the import and replace the `if (pending)` early return so the `GroundedIn` line stays visible (matching Hook/Style):

```tsx
  if (pending) {
    // generateVariantsAction is one atomic call with no incremental signal to
    // observe (truth pass, v1-gap-inventory.md) — an honest indeterminate state.
    return (
      <div className="flex flex-col gap-3">
        <GroundedIn>{groundedInText}</GroundedIn>
        <GeneratingSkeleton label="Writing script…" count={3} rowClassName="h-40" />
      </div>
    );
  }
```

Remove the now-unused `Skeleton` import from stage-script.tsx.

- [ ] **Step 6: Verify build + typecheck**

Run: `npm run typecheck && npm run build`
Expected: PASS, no unused-import lint error. (Presentational change - no vitest; verify visually in Round 1's browse walk.)

- [ ] **Step 7: Commit**

```bash
git add src/components/remix/generating-skeleton.tsx src/components/remix/stage-hook.tsx src/components/remix/stage-style.tsx src/components/remix/stage-script.tsx
git commit -m "polish(remix): unify hook/style/script generating states into one skeleton rhythm"
```

---

### Task 2: Stepper connector shows progression

Board (remix animate): "the stepper's connector is inert." The connectors between stages are uniform `<Separator>` regardless of how far the run has reached. Make a reached connector a stronger neutral line and an unreached one the faint hairline, with a <=200ms colour transition when `furthestStage` advances. Neutral only - a connector is progress, so amber and green are both banned here (green would read as a coloured progress bar competing with the score).

**Files:**
- Modify: `src/components/remix/stepper.tsx` (the `{i < STAGES.length - 1 && <Separator ... />}` line and the `Separator` import)

**Interfaces:**
- Consumes: existing `furthestIndex` already computed in `Stepper`.
- Produces: no signature change.

- [ ] **Step 1: GitNexus impact on Stepper**

Run: `node .gitnexus/run.cjs impact "Stepper" --direction upstream --repo .`
Expected caller: `remix-studio.tsx` only. Record risk; confirm with grep if UNKNOWN.

- [ ] **Step 2: Replace the connector**

In `src/components/remix/stepper.tsx`, replace:

```tsx
            {i < STAGES.length - 1 && <Separator className="mx-1 flex-1" />}
```

with:

```tsx
            {i < STAGES.length - 1 && (
              <div
                aria-hidden
                className={cn(
                  // Neutral only — a connector is progress, banned from amber and
                  // from the pos green (DESIGN.md Amber Law + Two-Hue Rule). A reached
                  // segment steps up to the strong rule weight; the rest stay hairline.
                  "mx-1 h-px flex-1 transition-colors duration-200 motion-reduce:transition-none",
                  i < furthestIndex ? "bg-[var(--line-strong)]" : "bg-border"
                )}
              />
            )}
```

- [ ] **Step 3: Remove the now-unused `Separator` import**

Delete `import { Separator } from "@/components/ui/separator";` from stepper.tsx (verify no other use in the file first: `grep -n "Separator" src/components/remix/stepper.tsx`).

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. Amber check: `grep -nE "bg-primary|text-primary|border-primary" src/components/remix/stepper.tsx` -> no new hits.

- [ ] **Step 5: Commit**

```bash
git add src/components/remix/stepper.tsx
git commit -m "feat(remix): stepper connector fills as the run progresses"
```

---

### Task 3: Stage-to-stage transition

Board (remix animate): "Stages hard-swap with zero transition." Wrap the active-stage render in a keyed wrapper so switching stages plays a short fade + 1-unit rise. Keyed on `activeStage` so React remounts and replays on every change; `RunLog` stays outside the wrapper so it does not re-animate on each stage move.

**Files:**
- Modify: `src/components/remix/remix-studio.tsx` (the scroll container holding the `{activeStage === ... && <Stage/>}` conditionals, ~lines 220-262)

- [ ] **Step 1: GitNexus impact on RemixStudio**

Run: `node .gitnexus/run.cjs impact "RemixStudio" --direction upstream --repo .`
Expected caller: `remix/page.tsx`. Record risk.

- [ ] **Step 2: Wrap the stage conditionals in a keyed animated div**

In `src/components/remix/remix-studio.tsx`, inside `<div className="min-h-0 flex-1 overflow-y-auto p-6">`, wrap ONLY the six `{activeStage === "..." && <Stage.../>}` blocks (not the trailing `{activeStage !== "prompt" && <RunLog .../>}`) like so:

```tsx
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            key={activeStage}
            className="animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
          >
            {activeStage === "prompt" && (
              <StagePrompt
                /* ...unchanged props... */
              />
            )}
            {/* ...research, hook, style, script, finish conditionals unchanged... */}
            {activeStage === "finish" && <StageFinish session={session} />}
          </div>

          {activeStage !== "prompt" && <RunLog runs={runs} />}
        </div>
```

Keep every stage component's props exactly as they are; only the wrapping `<div key=... className=...>` is added around the six stage conditionals.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. (Presentational; verified visually in Round 1.)

- [ ] **Step 4: Commit**

```bash
git add src/components/remix/remix-studio.tsx
git commit -m "feat(remix): fade+rise transition between studio stages"
```

---

### Task 4: Persona - example fills + why-each-field + enriched placeholders

Board (persona onboard): "four blank textareas quietly weaken every remix. Give example fills + a 'why this matters' line per field." Board (persona clarify): "Enrich the terse placeholders to name which generation behavior each field steers." Extend the `FIELDS` array with a `why` line and an `example`, render the `why` under each label, enrich the `placeholder`, and add an "Insert example" ghost button that fills only an empty field (never clobbers real text -> no-fabricated-data).

**Files:**
- Modify: `src/components/settings/persona-section.tsx`

**Interfaces:**
- Consumes: `Persona` from `@/server/services/persona` (fields `audience`, `voice`, `do`, `dont`).

- [ ] **Step 1: GitNexus impact on PersonaSection**

Run: `node .gitnexus/run.cjs impact "PersonaSection" --direction upstream --repo .`
Expected callers: `persona/page.tsx` and possibly a settings re-export. Record risk; grep-confirm if UNKNOWN.

- [ ] **Step 2: Replace the `FIELDS` constant**

```tsx
const FIELDS: { key: keyof Persona; label: string; placeholder: string; why: string; example: string }[] = [
  {
    key: "audience",
    label: "Audience",
    placeholder: "Who you make this for — niche, level, what they want. Steers who every script talks to.",
    why: "Sets who every generated hook and script is written for.",
    example: "Early-stage SaaS founders who code. Want blunt, tactical advice with no fluff.",
  },
  {
    key: "voice",
    label: "Voice",
    placeholder: "The tone every script should sound like. Steers word choice and rhythm.",
    why: "Shapes the wording and rhythm of every hook, outline and variant.",
    example: "Direct, dry, a little contrarian. Short sentences. No hype words, no emoji.",
  },
  {
    key: "do",
    label: "Do",
    placeholder: "Things every generation should do. Steers structure and what gets included.",
    why: "Rules the model follows in every generation.",
    example: "Open with a concrete number. End on one clear takeaway. Use real examples.",
  },
  {
    key: "dont",
    label: "Do not",
    placeholder: "Things every generation should avoid. Steers what gets filtered out.",
    why: "Rules the model avoids in every generation.",
    example: "No \"in today's world\" intros. No generic advice. No like-and-subscribe lines.",
  },
];
```

- [ ] **Step 3: Add the insert-example handler and render `why` + button**

Add the handler inside `PersonaSection` (after `save`):

```tsx
  // Fills an EMPTY field with its example on explicit click — never overwrites real
  // text (no-fabricated-data: an example must not masquerade as the user's own value).
  function insertExample(field: (typeof FIELDS)[number]) {
    setValues((prev) => (prev[field.key].trim() ? prev : { ...prev, [field.key]: field.example }));
  }
```

Replace the field-row `<div>` body so the `why` line renders under the label and the button appears only while the field is empty:

```tsx
        {FIELDS.map((field) => {
          const empty = !values[field.key].trim();
          return (
            <div key={field.key} className="flex flex-col gap-1.5 border border-border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`persona-${field.key}`}>{field.label}</Label>
                {empty && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid={`persona-example-${field.key}`}
                    onClick={() => insertExample(field)}
                    disabled={pending}
                  >
                    Insert example
                  </Button>
                )}
              </div>
              <p className="text-2xs text-faint">{field.why}</p>
              <Textarea
                id={`persona-${field.key}`}
                value={values[field.key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                rows={3}
                disabled={pending}
              />
            </div>
          );
        })}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. Amber check on the file -> no new `*-primary` hits (Insert example is a ghost button).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/persona-section.tsx
git commit -m "feat(persona): per-field why line, enriched placeholders, insert-example fills"
```

---

### Task 5: Persona - dirty-edit guard

Board (persona clarify): "add a dirty-edit guard (navigating away loses text)." Track unsaved edits with a pure helper, warn on browser unload while dirty, and show an inline "Unsaved changes" marker by the Save button. Known ceiling (ponytail): `beforeunload` covers reload / tab-close / hard navigation; it does NOT intercept Next.js soft (client Link) navigation. That's the smallest correct guard for the reported loss; full router interception is deferred (backlog entry below).

**Files:**
- Create: `src/components/settings/persona-dirty.ts`
- Create: `src/components/settings/persona-dirty.test.ts`
- Modify: `src/components/settings/persona-section.tsx`

**Interfaces:**
- Produces: `personaIsDirty(saved: Persona, current: Persona): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/settings/persona-dirty.test.ts
import { expect, test } from "vitest";
import { personaIsDirty } from "./persona-dirty";
import type { Persona } from "@/server/services/persona";

const base: Persona = { audience: "a", voice: "v", do: "d", dont: "x" };

test("identical personas are not dirty", () => {
  expect(personaIsDirty(base, { ...base })).toBe(false);
});

test("a changed field is dirty", () => {
  expect(personaIsDirty(base, { ...base, voice: "new" })).toBe(true);
});

test("every field is compared", () => {
  expect(personaIsDirty(base, { ...base, dont: "changed" })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/persona-dirty.test.ts`
Expected: FAIL ("personaIsDirty is not defined" / module not found).

- [ ] **Step 3: Write the helper**

```ts
// src/components/settings/persona-dirty.ts
import type { Persona } from "@/server/services/persona";

const KEYS: (keyof Persona)[] = ["audience", "voice", "do", "dont"];

/** True when any persona field differs between the last-saved snapshot and the
 *  current edits — drives the unsaved-changes guard in persona-section.tsx. Kept in
 *  a plain (non-"use client") module so it is unit-testable without rendering. */
export function personaIsDirty(saved: Persona, current: Persona): boolean {
  return KEYS.some((k) => saved[k] !== current[k]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/persona-dirty.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the guard into `PersonaSection`**

Add imports:

```tsx
import { useEffect } from "react";
import { personaIsDirty } from "@/components/settings/persona-dirty";
```

(merge `useEffect` into the existing `import { useState, useTransition } from "react";`).

Add a `saved` snapshot alongside `values` (init from `initial`), derive `dirty`, and register the unload guard:

```tsx
  const [values, setValues] = useState<Persona>(initial);
  const [saved, setSaved] = useState<Persona>(initial);
  const [pending, startTransition] = useTransition();
  const dirty = personaIsDirty(saved, values);

  // Reload / tab-close / hard-nav guard only. Soft (Next Link) navigation is not
  // intercepted — see the plan's deferral note. Registered only while dirty so a
  // clean form never triggers the native prompt.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
```

In `save`'s success branch, also update the snapshot:

```tsx
      setValues(result.persona);
      setSaved(result.persona);
      toast.success("Persona saved.");
```

Add an inline marker beside the Save button (replace the Save button block):

```tsx
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save persona"}
        </Button>
        {dirty && !pending && (
          <span data-testid="persona-dirty" className="font-mono text-2xs tracking-wide text-faint uppercase">
            Unsaved changes
          </span>
        )}
      </div>
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: PASS (persona-dirty tests included in the suite).

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/persona-dirty.ts src/components/settings/persona-dirty.test.ts src/components/settings/persona-section.tsx
git commit -m "feat(persona): dirty-edit guard warns before losing unsaved edits"
```

---

### Task 6: Docs, testid audit, Wave 1 housekeeping

Doc placement is per orchestrator ruling (2026-09-04): remix behavior stays in the remix docs; persona is part of the **analyze** component (persona.ts feeds analysis prompts), so persona notes go to the analyze docs, not remix.

**Files:**
- Modify: `documents/architect/core-components/remix/02-architecture.md` (note the shared `GeneratingSkeleton` rhythm, the stepper connector progression, and the keyed stage transition - grounded to code, evergreen, no dates, no em/en dashes, straight quotes, sentence-case headings)
- Modify: `documents/architect/core-components/analyze/03-feature-description.md` (persona onboarding: the four fields now carry a why-line, enriched placeholders naming which generation behavior each steers, and an insert-example fill - describe the behavior, grounded to `persona-section.tsx`, evergreen)
- Modify: `documents/architect/core-components/analyze/05-backlog-to-enhance.md` (add a row: "Persona dirty-guard covers reload / tab-close / hard-nav only; soft Next Link navigation is not intercepted. Add a router-level guard if in-app nav loss is reported. Round 1 candidate if it fits one small hook around the sidebar links.")
- Modify: `documents/planning/implementation-plan/2026-09-03-cross-ui-foundation-error-loading-states.md` (Wave 1 housekeeping: frontmatter `status: active` -> `shipped`, fill `shipped:` with the merge sha of PR #44/#45 if known, else leave the date)

Note: this wave adds no remix testids; the persona testids (`persona-dirty`, `persona-example-*`) are not referenced by any `04-test-cases.md`, so `testid-audit.sh` (docs -> src direction only) does not require them documented.

- [ ] **Step 1: Update remix 02-architecture.md** - one short subsection on the loading-rhythm/stepper/transition behavior, grounded to the three files.
- [ ] **Step 2: Update analyze 03-feature-description.md** - the persona onboarding examples/why/placeholder behavior.
- [ ] **Step 3: Update analyze 05-backlog-to-enhance.md** - the soft-nav deferral row.
- [ ] **Step 4: Flip Wave 1 plan frontmatter to shipped.**
- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`
Expected: all PASS; `testid-audit` -> "OK: N ids all present". Working tree clean after commit.

- [ ] **Step 5: Commit**

```bash
git add documents/
git commit -m "docs: wave-2 remix loading rhythm/stepper/transition + analyze persona onboarding; flip wave-1 plan to shipped"
```

---

## Self-Review

**Spec coverage:**
- remix animate (stage transitions) -> Task 3. remix animate (stepper connector) -> Task 2. remix polish (unify generating states) -> Task 1. persona onboard (examples + why) -> Task 4. persona clarify (enriched placeholders) -> Task 4. persona clarify (dirty guard) -> Task 5. Docs + housekeeping -> Task 6. All Wave 2 owned-route board items covered; studio items correctly DROPPED (Goal 2).
- Explicitly declined: none in scope. `/mine/*/studio` and `/logs`,`/runs` are out of Goal 1 scope per orchestrator, not declined here.

**Placeholder scan:** No TBD/TODO; every code step carries full code.

**Type consistency:** `GeneratingSkeleton` props match all three call sites (label/count/rowClassName/layout). `personaIsDirty(saved, current)` signature matches its test and its single call. `Persona` keys (`audience`,`voice`,`do`,`dont`) match `services/persona.ts`.

**Amber Law self-check:** No task introduces `*-primary`; connector and skeletons are neutral, persona example/dirty affordances are ghost/faint. Each task ends with a grep check.
