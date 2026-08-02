# Light theme implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable light theme to Crowsnest, default dark, toggled from the Settings page, with no visual flash on load.

**Architecture:** next-themes drives a class on `<html>` (`class="dark"` or `class="light"`). The dark palette stays the `:root` default in globals.css so Tailwind's `dark:` utilities keep working; the light palette moves from a `[data-theme="light"]` selector to a `.light` selector so the same class switch drives both the token block and the `dark:` variant. A client Appearance section in Settings calls `setTheme`. next-themes persists the choice in localStorage and injects a blocking script so there is no load flash.

**Tech Stack:** Next.js 16 (App Router, Turbopack), next-themes 0.4, Tailwind v4 (CSS-first, `@custom-variant`), TypeScript, vitest.

## Global constraints

- No system-follow. `enableSystem={false}`, themes are exactly `["dark", "light"]`, default `"dark"`.
- The toggle lives in the Settings page, nowhere else.
- Dark stays the `:root` default. Do not move the dark tokens into a `.dark` block.
- Amber budget holds: the Appearance control is neutral (raised surface for the active option), never the amber `primary` token. Same rule settings-nav.tsx and sidebar.tsx follow.
- Prose in any doc or comment follows the repo humanizer rules: no em or en dashes, straight quotes only, sentence case headings.
- Verification per task is `npm run typecheck`, `npm run lint`, and where noted `npm run test`. The final task is a live browser pass in light mode, because theme wiring and color reads are not meaningfully unit-testable here (repo memory: browser-check-beats-code-review).

---

### Task 1: Move the light palette to a class selector

**Files:**
- Modify: `src/app/globals.css:140` (change the selector `[data-theme="light"]` to `.light`)

**Interfaces:**
- Consumes: nothing.
- Produces: a `.light` class on any ancestor now swaps the token palette. `@custom-variant dark (&:is(.dark *))` at line 5 is unchanged, so `dark:` utilities still key off `.dark`.

- [ ] **Step 1: Confirm the two selectors that must stay as they are**

Run: `grep -nE "@custom-variant dark|^:root \{|data-theme|\.light" src/app/globals.css`
Expected: `@custom-variant dark (&:is(.dark *))` at line 5, `:root {` at line 67 (the dark defaults), `[data-theme="light"] {` at line 140.

- [ ] **Step 2: Change the light selector**

In `src/app/globals.css`, change the opening selector of the light block only:

```css
/**
 * Light theme. Same token names, ported from the prototype's [data-theme="light"]
 * block. Dark stays the default on :root; the .light class (set by next-themes)
 * swaps the palette. Light is the one place the no-shadow rule relaxes: flat
 * surfaces on a light ground need an edge.
 */
.light {
```

Leave every token value inside the block exactly as it is. Do not touch `:root` or the `@custom-variant` line.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (CSS change does not affect either, this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "refactor(theme): key light palette off .light class, not data-theme"
```

---

### Task 2: Add the ThemeProvider wrapper

**Files:**
- Create: `src/components/theme-provider.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ThemeProvider` component, a thin client wrapper over next-themes that forwards all props. Consumed by Task 3's layout.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Thin client boundary so the root layout (a server component) can wrap children in
// next-themes without becoming a client component itself. All configuration is passed
// as props from layout.tsx, kept there so the theme policy reads in one place.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/theme-provider.tsx
git commit -m "feat(theme): add ThemeProvider client wrapper over next-themes"
```

---

### Task 3: Wire the provider into the root layout

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `ThemeProvider` from Task 2.
- Produces: `<html>` now carries the theme class next-themes sets at runtime, defaulting to dark. The Toaster follows the active theme (its wrapper in `src/components/ui/sonner.tsx` already reads `useTheme`).

- [ ] **Step 1: Import the provider**

Add to the imports in `src/app/layout.tsx`:

```tsx
import { ThemeProvider } from "@/components/theme-provider";
```

- [ ] **Step 2: Replace the returned tree**

Replace the `return (...)` block of `RootLayout` with:

```tsx
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${archivo.variable} ${plexMono.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={["dark", "light"]} disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
```

Three changes to notice: `className="dark"` is gone from `<html>` (next-themes now sets the class), `suppressHydrationWarning` is added (the injected script sets the class before React hydrates, which would otherwise warn), and `<Toaster />` drops its hardcoded `theme="dark"` prop so the wrapper's `useTheme` drives it.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Build to catch a client/server boundary or hydration issue**

Run: `npm run build`
Expected: build completes. This is the cheapest place to catch a bad provider boundary before the browser pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(theme): wrap app in ThemeProvider, default dark, no load flash"
```

---

### Task 4: Add the Appearance section to Settings

**Files:**
- Create: `src/components/settings/appearance-section.tsx`
- Modify: `src/app/(shell)/settings/page.tsx` (add the nav item and render the section)

**Interfaces:**
- Consumes: `useTheme`/`setTheme` from next-themes (context provided by Task 3), `cn` from `@/lib/utils`.
- Produces: `AppearanceSection` component (no props). A new `{ id: "appearance", label: "Appearance" }` nav item and a matching `<div id="appearance">` section on the page.

- [ ] **Step 1: Write the section component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

// Manual dark/light only, no system option, per the locked design. The control is a
// neutral radiogroup (raised surface marks the active option), never the amber primary
// token, matching settings-nav.tsx and sidebar.tsx: amber on this screen is reserved
// for the scoring save button.
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the resolved theme after mount (it reads localStorage on the
  // client). Rendering the active state before mount would mismatch the server HTML, so
  // nothing is marked active until mounted. The buttons still work on first click.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Theme for this workspace. Saved on this device.</p>
      </div>

      <div role="radiogroup" aria-label="Theme" className="flex w-fit gap-0.5">
        {THEME_OPTIONS.map((opt) => {
          const active = mounted && theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "rounded-sm px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-popover font-semibold text-foreground"
                  : "font-normal text-muted-foreground hover:bg-popover/60 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Import the section in the settings page**

Add to the imports in `src/app/(shell)/settings/page.tsx`:

```tsx
import { AppearanceSection } from "@/components/settings/appearance-section";
```

- [ ] **Step 3: Add the nav item**

In `SETTINGS_NAV_ITEMS`, add Appearance as the last entry (order here is the render order):

```tsx
  { id: "onboarding", label: "Onboarding" },
  { id: "appearance", label: "Appearance" },
];
```

- [ ] **Step 4: Render the section**

The onboarding block is currently the last section and uses `pt-8` with no bottom border. Appearance becomes the new last section, so give onboarding a bottom border again and render Appearance last with `pt-8`. Replace the onboarding `<div>` with:

```tsx
        <div id="onboarding" className="scroll-mt-6 border-b border-border py-8">
          <OnboardingSection />
        </div>

        <div id="appearance" className="scroll-mt-6 pt-8">
          <AppearanceSection />
        </div>
```

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/appearance-section.tsx "src/app/(shell)/settings/page.tsx"
git commit -m "feat(theme): add Appearance toggle to Settings page"
```

---

### Task 5: Tokenize the outlier-history chart colors

**Files:**
- Modify: `src/components/channels/outlier-history-chart.tsx`

**Interfaces:**
- Consumes: existing Tailwind token utilities (`stroke-*`, `fill-*`) already resolved from globals.css.
- Produces: the chart's structural strokes now follow the active theme. No exported signature changes.

Context: only this file has real hardcoded colors in code. The other four files the handoff grep flagged (`carousel-viewer.tsx`, `video-player.tsx`, `stat-tile.tsx`, `outlier-badge.tsx`) match only in comment text and already use tokens, so they need no change. Verify that in Step 1 before touching anything.

- [ ] **Step 1: Confirm the other four are comment-only**

Run: `grep -nE "#[0-9a-fA-F]{6}|rgb\(|rgba\(" src/components/video/carousel-viewer.tsx src/components/video/video-player.tsx src/components/dashboard/stat-tile.tsx src/components/feed/outlier-badge.tsx`
Expected: every match is inside a `//` or `/* */` comment. If any is a live style value, stop and tokenize it too before continuing.

- [ ] **Step 2: Remove the three structural color constants**

In `src/components/channels/outlier-history-chart.tsx`, delete these three lines:

```tsx
const LINE_COLOR = "#767D93";
const GRID_COLOR = "#242938";
const RING_COLOR = "#12151C";
```

Keep `DOT_FILL` and the `<defs>` gradient stops as they are. Those are the DESIGN.md heat ramp (warm amber to red), the same intended hue in both themes.

- [ ] **Step 3: Point the gridlines at the border token**

Replace the gridline `<line>` (the `stroke={GRID_COLOR}` one) with:

```tsx
          return <line key={i} x1={PAD_X} x2={width - PAD_X} y1={y} y2={y} className="stroke-border" strokeWidth={1} />;
```

- [ ] **Step 4: Point the trend line at the muted-foreground token**

Replace the trend `<polyline>` with:

```tsx
        <polyline points={linePath} fill="none" className="stroke-muted-foreground" strokeWidth={2} />
```

- [ ] **Step 5: Point the dot ring at the card token**

The outlier dots stroke a ring the color of the surface they sit on so they read as cut into the card. Replace `stroke={RING_COLOR}` on the outlier `<circle>` with `className="stroke-card"`:

```tsx
            <circle
              key={`dot-${c.point.videoId}`}
              cx={c.x}
              cy={c.y}
              r={5}
              fill={DOT_FILL[tier]}
              className="stroke-card"
              strokeWidth={2}
              pointerEvents="none"
            />
```

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/channels/outlier-history-chart.tsx
git commit -m "refactor(channels): tokenize outlier chart strokes for theme support"
```

---

### Task 6: Live browser pass in light mode

**Files:** none (verification task).

This is the design check on the light look. Run it on the live dev server, not from the Bash tool (repo memory: sandboxed-bash-reaps-servers). Bring the stack up with `/crowsnest-up` if it is not already running, and browse `http://localhost:3000`, never `127.0.0.1` (Next 16 blocks Server Actions cross-origin).

- [ ] **Step 1: Confirm the full test suite still passes**

Run: `npm run test`
Expected: PASS (no theme change should touch existing tests; this catches an accidental break).

- [ ] **Step 2: Toggle to light and confirm persistence**

Open `http://localhost:3000/settings`, scroll to Appearance, click Light. Confirm the whole app switches to the light palette and the choice survives a reload (next-themes localStorage). Confirm no dark flash on reload.

- [ ] **Step 3: Screenshot the main screens in light mode**

Visit each of Dashboard, Feed, Channels (including a channel detail with the outlier-history chart), and Settings. Confirm text contrast reads, borders are visible, the chart gridlines/line/dots read against the light card, and the amber primary and destructive still stand out. Screenshot each.

- [ ] **Step 4: Check the toast in light mode**

Trigger a toast in light mode (for example save a setting) and confirm it uses the light popover tokens, not dark.

- [ ] **Step 5: Toggle back to dark and confirm no regression**

Click Dark, confirm the app returns to the original dark look with no leftover light styling.

- [ ] **Step 6: If any screen reads poorly, fix it and note it**

Any fix at this stage is a hardcoded color or a wrong token found in the browser that the grep missed. Fix it with a token, commit it on its own, and note it in the PR description. If everything reads, say so plainly.

---

## Self-review notes

- Spec coverage: default dark (Task 3 `defaultTheme="dark"`), manual toggle in Settings (Task 4), no system-follow (Task 3 `enableSystem={false}`, `themes` list), class-based one-switch mechanism (Task 1 selector move plus Task 3 `attribute="class"`), no load flash (Task 3 `suppressHydrationWarning` plus next-themes injected script), hardcoded-color audit (Task 5, scope corrected to the one real file). All covered.
- The Toaster fix (drop `theme="dark"`) is folded into Task 3 because the same edit touches layout.tsx.
- Type consistency: `ThemeProvider` props are forwarded via `ComponentProps<typeof NextThemesProvider>`, so the exact prop names in Task 3 (`attribute`, `defaultTheme`, `enableSystem`, `themes`, `disableTransitionOnChange`) are next-themes' own and typed.
- No new migration, so the dev-db-not-migration-tracked gotcha does not apply.
