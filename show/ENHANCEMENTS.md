# Crowsnest — 100 enhancements

Numbered so you can just say "do 4, 18, 61". Effort: **S** = minutes, **M** = an hour of careful work, **L** = touches behavior or data.

---

## Type (1–12)

1. **S** Numeric weight — 52px scores are IBM Plex Mono 400 and read thin on the dark ground; 500 gives them authority at the same size.
2. **S** Two mono sizes doing one job — 13px and 15px both serve as meta/label. Fix: 13px = labels, 15px = values, nothing else.
3. **S** Sidebar group labels are 15px mono while every other label is 13px — match them.
4. **S** Optical letter-spacing — `-.02em` suits 52px but is tight at 34px; use `-.015em` on h1 and `-.01em` on 24px.
5. **S** Tabular numerals are on the big scores but missing on the small mono counts in the sidebar and feed meta — column edges jitter as values change.
6. **M** Line-height on 24px captions is 1.35 in one place and 1.4 in another — pick 1.35.
7. **S** `text-wrap: pretty` is on hero copy but not on card captions or day-cell titles, where the orphan lines actually show.
8. **S** The 19px body size appears only on the welcome screen; either use it as the standard reading size or drop it to 17px for consistency.
9. **M** Uppercase mono labels have no letter-spacing — `.06em` makes 13px caps far more legible.
10. **S** Feed card overlay titles are 19px/1.25 with a 3-line clamp — at grid width that clamps mid-word; 17px/1.3 fits the same box with fewer cuts.
11. **M** Quote treatment — the verbatim hook uses curly quotes inline in mono; hanging the opening quote in the margin reads much better.
12. **S** `font-variant-numeric` on the calendar reach figures so the month grid's numbers align vertically.

## Buttons & controls (13–28)

13. **M** Ghost buttons have no resting affordance — "Open post", "stop watching" and the tabs are invisible until hover. Give secondary actions a 1px `var(--line)` pill outline.
14. **S** No `:active` state anywhere — a one-step darker fill on press makes the app feel physical.
15. **S** Icon-only buttons (rail toggle, dialog close) are under 32px of hit target.
16. **M** Disabled states — "Continue" with nothing picked simply doesn't respond; render it at 45% opacity with `cursor:not-allowed`.
17. **M** Loading state on buttons — "Sync" and "Add channel" have no in-flight treatment, so double-clicks are possible.
18. **S** Destructive actions ("stop watching", "Remove", "Reset") should carry `--neg` at rest, not only on hover.
19. **M** Segmented controls (Grid/List, band filters) don't show keyboard focus on the selected option.
20. **S** Button label padding is 20px on some, 16px on others — normalize to 20px horizontal.
21. **M** The dropdown filters open on click but don't close on Escape.
22. **M** Dropdowns don't return focus to their trigger on close.
23. **S** The "hide" link in the checklist is a button styled as text at 13px — below comfortable tap size.
24. **M** Primary buttons in dialogs should be right-aligned with the secondary to their left; currently they read left-flush like the rest of the app, which is fine — but the dialog is the one place a conventional order helps.
25. **S** Toast Undo is text-only; make it a bordered pill so it reads as the action.
26. **M** Add a keyboard shortcut hint (⌘K style) to the Sync button's title attribute for discoverability.
27. **S** The rail toggle glyph (« / ») is mono punctuation — a proper chevron icon is clearer.
28. **M** Buttons that navigate vs. buttons that mutate look identical; a subtle weight difference (500 vs 400) would separate them.

## Color & tokens (29–38)

29. **S** `--dim` is nearly unused — most inactive things reach for `--t3`, so the ramp isn't earning its keep. Either use `--dim` for disabled or delete it.
30. **M** Amber appears on scores, the primary button and chart marks simultaneously on the dashboard — three amber roles on one screen dilutes it. Keep it on outliers + one action.
31. **M** Light mode's `--acc` (#96600A) is much lower-chroma than the dark accent; the two themes don't feel like the same brand.
32. **S** `--accWash` at 12% is invisible against `--s1` in light mode — needs its own value per theme.
33. **M** Chart greys (`--dim` dots) fall below 3:1 against the ground in light mode.
34. **S** `--line` and `--line2` are close enough in dark mode that the two-tier rule hierarchy doesn't read; widen the gap.
35. **M** Negative/positive colors exist as `--neg` but there's no `--pos` — gains are drawn in amber, which conflates "outlier" with "up".
36. **S** The gradient overlay on feed cards hardcodes `rgba(11,11,12,…)` — breaks in light mode.
37. **M** Selection color (`::selection`) is unstyled — falls back to browser blue.
38. **S** Scrollbar colors are themed for the sidebar only; the main pane still shows the OS default.

## Layout & spacing (39–50)

39. **M** Section gaps are 96px in some screens and 64px in others with no rule behind which — pick 96 for screen-level, 64 for block-level.
40. **S** The main pane's max content width is unset, so on a 2560px monitor the tables stretch to unreadable line lengths. Cap at ~1400px.
41. **M** The dashboard's two chart columns collapse at different breakpoints than the stat row, producing an awkward middle state around 900px.
42. **S** Page top padding differs by screen (24px on dashboard, 0 on feed) — the h1 baseline jumps as you navigate.
43. **M** Table header rules use `--line2` and row rules use `--line`; the last row has a rule with nothing under it.
44. **S** The stat row on My channel uses `gap:56px` — at narrow widths that wraps into a ragged two-column mess; a grid with `auto-fit` fixes it.
45. **M** Calendar cells are square-ish at wide widths and squat at narrow ones; an `aspect-ratio` floor keeps the month legible.
46. **S** The toast overlaps the sidebar footer sync dots at short viewport heights.
47. **M** The remix stage rows have 20px inner padding but the stage header doesn't align to it.
48. **S** Chart captions sit 20px under their SVG in one place, 24px in another.
49. **M** Sticky sidebar has `height:100vh` — on mobile browsers with dynamic toolbars this clips; `100dvh` is correct.
50. **S** Dialog max-height 88vh with internal scroll, but no scroll shadow, so it's not obvious there's more below.

## Motion (51–58)

51. **M** Screen transitions fade-rise uniformly; navigating *back* should reverse direction, not repeat the forward motion.
52. **S** Bar growth animates on first paint but re-animates on every unrelated state change.
53. **M** Numbers don't count up — the 52px score changing between posts would benefit from a 200ms tween.
54. **S** Toasts appear instantly and disappear instantly; 160ms in, 240ms out.
55. **M** The dialog has no entrance animation, so it snaps in.
56. **S** Hover transitions are unspecified on several buttons, so color changes are instant while others are 120ms.
57. **M** Sync progress bar steps discretely every 400ms; interpolating between steps looks like real work.
58. **S** `prefers-reduced-motion` is handled globally at `.001s` — good — but the count-ups and progress should stay legible at that setting, not vanish.

## States: empty, loading, error (59–70)

59. **L** Charts have no empty state — with nothing watched, the donut and scatter render blank axes rather than a sentence.
60. **M** The calendar has no empty state for a month with no activity.
61. **L** No skeleton/loading state for the feed after a sync starts — content pops in.
62. **M** "Removed from Instagram" appears on the post screen but the feed card doesn't mark it, so the state is discovered too late.
63. **L** No partial-failure detail — the banner says "3 of 8 refreshed" but there's no way to see *which* 5 failed.
64. **M** Rate-limit state shows a message but no retry countdown.
65. **L** Offline state isn't represented at all.
66. **M** Vault empty state is a sentence with no action button.
67. **M** A channel with too few posts shows "—" for its median without explaining that medians need ~10 posts.
68. **L** Search with no results returns an empty grid, not a "nothing matches, widen the score" message.
69. **M** First-run vs. returning-user dashboard are identical; the first run has no data yet and should say so.
70. **M** The checklist can be hidden but not brought back.

## Accessibility (71–82)

71. **M** No `aria-label` on icon-only buttons — the rail toggle and close read as blank to a screen reader.
72. **M** Nav buttons don't expose selected state (`aria-current="page"`).
73. **L** The dialog doesn't trap focus, and Tab escapes to the page behind it.
74. **M** Dialog needs `role="dialog"` + `aria-modal` + a labelled title.
75. **M** Charts are SVG with `<title>` on dots — good — but no accessible summary of the whole chart.
76. **M** Toasts aren't announced (`role="status"`).
77. **M** The score bars convey meaning by color alone; a text value is present but not associated.
78. **S** Focus ring is 1px accent at 3px offset — 2px reads better and matches the design system's guidance.
79. **M** Dropdowns are div-based, not `<select>` or a listbox pattern, so arrow keys don't work.
80. **S** `lang` attribute on the document.
81. **M** Tab order in the sidebar goes through group labels' whitespace when collapsed.
82. **M** Calendar day cells are buttons but don't expose their date as an accessible name ("24" alone is ambiguous).

## Data honesty (83–90)

83. **L** Scores are computed against a median that's stated but never shown as a distribution — a tiny sparkline of the channel's last 30 posts would justify the number.
84. **M** "17 posts scored" and the feed count can diverge when filters are active; label which is which.
85. **L** The scatter's x-axis is log-scaled but unlabelled as such.
86. **M** The donut shows share of *outliers*, not share of posts — the caption says so, but the chart doesn't.
87. **L** No confidence treatment on channels with 3 posts vs 300 — both render a hard number.
88. **M** Timeframe filter says "30 days" but the calendar shows a calendar month; two different windows on one screen.
89. **M** Engagement is shown as a raw count; as a rate it would be comparable across channels.
90. **L** No indication of when a score will be recomputed (medians move as new posts land).

## Per-screen polish (91–100)

91. **M** **Feed** — no way to dismiss a post you've judged and don't want to see again.
92. **M** **Post** — the transcript tab has no copy button.
93. **M** **Remix** — no way to compare two stage outputs side by side.
94. **M** **Vault** — no grouping or sorting by why it was saved.
95. **M** **Channels** — the health column is a word ("healthy", "partial"); a small run-history strip communicates it faster.
96. **M** **My channel** — the calendar and the post list show the same data twice with no cross-highlight.
97. **M** **Dashboard** — the ranking table's clickable rows don't hover-highlight.
98. **M** **Settings** — no confirmation that a theme change persisted.
99. **M** **Onboarding** — no way to go back to a completed step and change an answer.
100. **L** **Global** — no ⌘K command palette, though the sidebar footer already advertises "⌘K · jump to anything".
