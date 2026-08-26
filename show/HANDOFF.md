# Crowsnest visual layer — build handoff

Companion to `Crowsnest Visual System.dc.html` (turns 1–4). Flows are unchanged; this is the visual layer only.
Rules that hold everywhere: dark only · zero radius · flat fills · 2px rules do the grouping · flush left, including button labels · amber = the multiplier · red = failure · no third hue · a missing value is an em dash, never a zero · no abbreviated numbers (`2,272,877`, not `2.3M`).

---

## 1. `src/app/globals.css` — replace the token block

```css
@import "tailwindcss";

/* Dark only. No :root/.dark pair, no light block to keep in sync. */
:root {
  /* ground */
  --background:            #0d0c0c;
  --card:                  #151413;
  --card-raised:           #1b1a18;
  --popover:               #1b1a18;
  --muted:                 #232120;
  /* ink */
  --foreground:            #f2f0ed;
  --muted-foreground:      #918b85;
  --faint-foreground:      #6a6560;
  /* rules */
  --border:                #2a2827;   /* 1px hairline */
  --rule:                  #3b3835;   /* 2px section rule */
  --input:                 #3b3835;
  /* the multiplier — this is the identity */
  --primary:               #f5a524;
  --primary-foreground:    #16120a;
  --accent-300:            #ffd489;
  --accent-400:            #ffbc4d;   /* hover */
  --accent-500:            #f5a524;   /* base */
  --accent-600:            #cf861a;   /* pressed */
  --accent-700:            #8c5a12;   /* rules on amber */
  --accent-tint:           #2b1e08;   /* tinted fill on dark */
  --ring:                  #f5a524;
  /* failure — the only other hue */
  --destructive:           #ef4a2b;
  --destructive-foreground:#14100f;
  --destructive-tint:      #2c1109;
  /* geometry */
  --radius:                0rem;
}
```

Deleted: `--primary #6a5ae0`, `--accent #f5a524`, `--ring #7c6cff`. Amber moves from decoration to `--primary`, so all 26 wrapped components inherit the new identity with no component edits.

```css
@theme {
  --font-sans: "Archivo", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --text-2xs:     0.625rem;   /* 10px  · 1.0  · +0.14em caps · field labels */
  --text-xs:      0.6875rem;  /* 11px  · 1.35 · meta, units, n= */
  --text-sm:      0.78125rem; /* 12.5px· 1.45 · secondary copy */
  --text-base:    0.875rem;   /* 14px  · 1.5  · body, captions */
  --text-md:      1rem;       /* 16px  · 1.35 · card titles */
  --text-lg:      1.25rem;    /* 20px  · 1.2  · section heads */
  --text-xl:      1.625rem;   /* 26px  · 1.1  · page titles */
  --text-2xl:     2.125rem;   /* 34px  · 1.05 · dashboard stats */
  --text-hero:    2.75rem;    /* 44px  · 0.9  · card multiplier */
  --text-hero-lg: 4rem;       /* 64px  · 0.85 · detail multiplier */

  --breakpoint-lg:  1024px;
  --breakpoint-xl:  1280px;
  --breakpoint-2xl: 1440px;
  --breakpoint-3xl: 1680px;
  --breakpoint-4xl: 1920px;
}

body { font-feature-settings: "ss01"; }
.tabular, .font-mono, [data-metric] { font-variant-numeric: tabular-nums slashed-zero; }
```

Archivo 800 carries display numbers (multiplier, dashboard stats). IBM Plex Mono carries every number that sits in a column, a row or a timestamp.

---

## 2. Shell

```css
:root { --rail: 56px; }
@media (min-width:1280px){ :root{ --rail:240px } }
@media (min-width:1680px){ :root{ --rail:264px } }

.app  { display:grid; grid-template-columns:var(--rail) 1fr; min-height:100dvh }
.page { padding:24px }                    /* NO max-width, NO margin:auto */
@media (min-width:1440px){ .page{ padding:32px } }
@media (min-width:1920px){ .page{ padding:40px } }
.prose{ max-width:72ch }                  /* the only cap left in the app */

.feed                        { display:grid; gap:16px;
  grid-template-columns:repeat(auto-fill,minmax(200px,1fr)) }
.feed[data-density="compact"]{ gap:8px;
  grid-template-columns:repeat(auto-fill,minmax(140px,1fr)) }

.detail { display:grid; gap:32px; grid-template-columns:1fr }
@media (min-width:1120px){ .detail{ grid-template-columns:clamp(300px,24vw,400px) 1fr } }
```

Delete the 1120px centred wrapper. Feed columns: 4 at 1280, 5 at 1440–1600, 6 at 1680, 7 at 1920, 9 at 2560 (compact: 6/7/9/10/13).

---

## 3. Component variants to add (no parallel components)

| Component | Variant | Notes |
|---|---|---|
| Card | `variant="tile"` `density="comfortable\|compact"` | The outlier card. Zero padding, 9:16 media, 1px `--border`. |
| Badge | `variant="multiplier"` / `"multiplier-cold"` | Amber ≥1.0×, `--muted-foreground` below. |
| Badge | `variant="never-synced"` / `"stale"` | Hollow square vs filled grey square. |
| Button | `size="xs"` | h-7, filter bar and card actions. |
| Select | `variant="inline"` | Borderless label+value+caret; filters read as a sentence. |
| ToggleGroup | `variant="band"` | Follower band row, always visible, counts inline. |
| Alert | `variant="failure"` / `"degraded"` | The run strip. Failure is not dismissible; degraded is. |
| Table | `density="compact"` | 32px rows, mono numerals. |
| Progress | `variant="phases"` | Seven sync phases as ticked segments. |
| **new** | `<Metric value n unit />` | ~30 lines on Card + Tooltip. Nothing in the 26 carries a sample size, and every own-channel figure needs one. |

---

## 4. Screens

**Outlier feed** (turn 1c, 2a). Header: title 26px + mono state line (`8 posts · 1 channel · median 224,403 (n=8)`), grid/list and comfortable/compact toggles, Sync. 2px rule. Filters as a sentence of inline Selects (`showing all scores from all channels on Instagram posted in the last 30 days sorted by highest score`) with Save this view / Reset. Follower band is its own bordered row with a 2px `--accent-700` left rule and per-band counts; `Unknown —` is @hormozi.

Card: media 9:16 `grayscale(1) contrast(1.06)` at rest → `none` on hover; rank flag top-left flush; duration bottom-right flush; multiplier Archivo 800 44/0.9 −0.03em tabular; ruler 2px log-scaled `(log s − log .2)/(log 12 − log .2)` floor 1.5% with a fixed 1.0× tick at 39.3%; caption 600 14/1.35 clamped 2 lines, 38px min-height; meta mono 11/1.4 two lines. Padding 12, internal gap 9, grid gap 16.
States: rest · hover (border amber, card → `--card-raised`, frame to colour, 90ms colour-only, no transform) · focus-visible (2px `--ring` offset 2; arrow keys move by row/column) · loading (static skeleton at real block sizes, no shimmer) · data missing (em dash, empty track, hatched well, `NO FRAME`) · removed from IG (2px red left rule, frame 60%).
Compact: caption and ruler drop, multiplier moves onto the frame over a bottom scrim at 26px, views stay.

**Video detail** (turn 2b). `.detail` grid. Left: player 9:16 with a bottom bar (amber play triangle, 2px track, `0:00 / 1:24`), then a metrics panel — 64px multiplier, ruler labelled `0.2× / 1.0× = 224,403 / 12×`, then a 2-col grid (views, channel median with `(n=8)`, length, posted, likes —, comments —), then the channel row. Right: the three approved tabs; Hook & Structure holds Hook (timing + descriptor + a Verbatim row that dashes when the transcript text is empty), Story beats (timing / label / descriptor with a 2px share-of-84s bar), Visual layout (on-screen text, text position thirds diagram, cut rhythm, framing — all dashed today, with a Run frame pass action), Why it worked at 72ch. Reading path ends in exactly three exits: Remix filled amber, Save to Vault outlined, Copy as prompt text. Remix is the only amber button on the page.
Tags: transcript-derived tags amber on `--accent-tint`; picture-describing tags grey and suffixed `·unverified`.

**Missing data** (turn 2c). No median → `—` at full size, empty track, tick kept, card sorts last not out. No frame → hatched `--muted` well, aspect preserved. No transcript → one dashed line + Transcribe action (also when the row exists with empty text). No analysis → AnalysisGate, both analysis tabs stay enabled. Partial analysis → dashes + `·unverified`. Unknown followers → band `Unknown`, excluded from band filters, never defaulted to Nano.

**Sync failure** (turn 3a). One persistent strip under the page header, `Alert variant="failure"`: 2px red left rule, class name + error code, one sentence, then four fields in fixed order — Kept / Stopped at / Retry opens / Affects — and one action panel on the right. Classes: `IG_RATE_LIMITED` (account-wide; retry disabled with a live countdown), `IG_SESSION_EXPIRED` (copyable `npm run ig:login`), `IG_SERVICE_DOWN` (polls, self-clears). The amber `Partial · recovered` strip is the only dismissible one. Strip, channel row and Instagram panel print the same class and the same retry time from the same object.

**Channels** (turn 3b). Never synced: hatched row, hollow status square, dashes in every data cell, band unknown, and the only filled amber button in the table (`First sync`). Stale: solid row, filled grey square, real numbers at full contrast plus a dated caption. Run history: eight 5px bars, newest right — full height ok, half height red failed, amber partial. No axis, no tooltip, no chart library.

**Remix studio** (turn 3c, 4b). Five equal stage cells, 2px bottom border: done = `--accent-tint` + amber rule, active = amber rule on `--card`, blocked = `--destructive-tint` + red rule, waiting = `--border` rule. A blocked stage carries the failure; done stages keep their content readable and copyable; waiting stages keep their names (dashed border, 75% opacity). Retry stays enabled for a local port. Add `···` → **Discard and re-analyse** with a confirm dialog — without it the dashed Visual layout section can never be filled.

**My channel** (turn 3d). Median reach **9** (n=8), followers **5**, published **8** (planned —), own multiplier withheld as `—`. Each small count is echoed as that many 7px marks. No trend line, no percentage change, no sparkline, no comparison to @kallaway; a `Too few to trend` panel with an `8 / 30` progress rule names what unlocks and when. Per-post reach dashes. A reach of 9 renders in `--foreground` at the same size as any other true number.

**Dashboard / Vault / Scripts / Settings** (turn 4a, 4c, 4d). Dashboard: run strip, then one hero panel (200px 9:16 + 64px multiplier + caption + Remix) and a right column of next-best, own-channel and coverage. Vault: 6-column table, 48px 9:16 tiles, score at 22px keeping the amber rule; Scripts reuses it with Stage/Updated and no thumbnail. Settings is a read-only status report with two buttons; binaries have three states — `found` / `unknown` / `missing` — because a wrong green is worse than an honest gap.

**Calendar** (turn 4e). Published = filled amber chip, planned = dashed outline with a dashed value. Empty days stay empty — no zero, no repeated "no posts". This is the only non-multiplier use of amber; it earns it by meaning "this exists".

---

## 5. Content rules for anything you generate later

Only these creators and numbers exist: @kallaway (442,447 followers, 8 posts, median 224,403) with scores 10.1× / 2.3× / 1.6× / 1.1× / 0.9× / 0.8× / 0.5× / 0.2× against 2,272,877 / 524,960 / 359,004 / 247,324 / 201,483 / 189,022 / 120,187 / 38,580 views; @hormozi tracked and never synced; @kaiships.ai — 8 posts, ~5 followers, median reach 9. Anything else is a dash.
