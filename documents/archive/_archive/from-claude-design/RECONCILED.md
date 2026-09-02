# What the visual layer actually is

Three specs came back from the Claude Design project and they disagreed. Kai's call: follow `Crowsnest Prototype.dc.html`. Where a written doc contradicts the rendered prototype, the prototype wins. Everything below was read out of that file, not out of the prose.

Source of truth, saved locally: `Crowsnest-Prototype.dc.html`, with its CSS layer extracted to `prototype-extracted.css`.

## Resolved

| Decision | Result | Read from |
|---|---|---|
| Ground | `#0B0B0C` app, `#141416` card, `#1C1C1F` popover and hover | prototype `:root` |
| Ink | `#F2F2F0` primary, `#9A9A96` secondary, `#6B6B68` tertiary, `#55554F` dim | prototype `:root` |
| Rules | `#1F1F23` hairline, `#3E3E46` strong | prototype `:root` |
| Amber | `#E8A33D`, on `#0B0B0C` | prototype `:root` |
| Failure | `#D9503F` | prototype `:root` |
| Radius | 0 everywhere, buttons are pills at 999px | `primary()`, `ghost()`, `iconBtn()`, and a blanket `button { border-radius: 999px }` |
| Type | Archivo 400 / 500 / 600 / 700 for words, IBM Plex Mono 400 / 500 for every number | prototype font shorthand, 304 uses |
| Type scale | 34 / 24 / 19 / 17 / 15 / 13, no other size appears | same |
| Focus | 2px amber outline, offset 2 | prototype base layer |
| Light theme | exists as `[data-theme="light"]` | prototype `:root` sibling |

## The amber question, and the mistake in the middle of it

I told Kai the prototype had no amber buttons and that his law doc forbade amber on `--primary`. Both were wrong.

The first was a bad measurement. Button styles are template bindings (`style="{{ primaryBtn }}"`), so grepping the markup for `background:` found nothing and I read the absence as evidence. The helper it resolves to is amber filled:

```js
primary(dis) { return '...color:var(--onAcc);background:var(--acc);
  border:1px solid var(--acc);border-radius:999px;padding:10px 20px...' }
```

The second was a misreading. Section 3 of `uploads/crowsnest-design-system.md` lists "đúng một primary action mỗi màn hình" under what amber is allowed on. What it bans is amber on nav active state, toggles, secondary buttons, the logo, checklists, progress bars and sidebar count badges.

So `--primary` is amber. The budget is a usage rule, not a token rule, and the prototype holds it by hand: 6 `primary()` calls against 24 `ghost()` across 15 screens. At most one `variant="default"` per screen. Everything else is secondary, outline or ghost.

## Applied

- `src/app/globals.css`: token block replaced. Adds `--score`, `--score-wash`, `--score-line`, a 5 step amber ramp, `--faint`, `--dim`, `--line-strong`, `--destructive-wash`, hatch tokens, and a light block that nothing toggles yet.
- `src/app/layout.tsx`: Inter out, Archivo and IBM Plex Mono in.
- `src/components/ui/button.tsx`: every radius utility to `rounded-full`. One file, no parallel component.

Build, 560 tests and lint all pass.

## Not applied, and why

- `ENHANCEMENTS.md`, the 100 item list, critiques an older iteration. It names tokens (`--acc`, `--accWash`, `--dim`, `--t3`, `--line2`) and features (donut, scatter, onboarding checklist) that partly exist in the prototype and partly do not. Worth mining later, item by item, against what is actually built. Not a spec.
- `HANDOFF.md`'s type scale (10 steps to 64px) and its "no max-width at all". The prototype uses 6 sizes and caps content. Kai's doc says 1440px. Unresolved until a real screen needs it.
- `--pos` green exists in the prototype tokens but is used once in the whole file. Left out of `globals.css` deliberately: an unused hue invites reuse, and the design system says normal state carries no colour.

## Still open

- Table row height. Kai's doc says 56px, `HANDOFF.md` says 32px compact. The prototype needs measuring per table.
- Vocabulary. Kai's dictionary says score, post, local service, My channel, Sync. `CONTEXT.md` currently says Tracked channel and Owned channel, and the codebase says sidecar throughout. Renaming is a separate pass.
