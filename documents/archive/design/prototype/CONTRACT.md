# Prototype panel contract

You produce HTML fragments only. No `<style>`, no `<script>`, no `<html>`. The shell supplies the design system and all behaviour. Use only the classes and data attributes below, so 36 panels from four authors look like one product.

## One flow, one section

```html
<section class="flow" id="A1">
  <button class="flow-head" data-acc>
    <span class="flow-id">A1</span>
    <span class="flow-name">First run, empty app</span>
    <span class="flow-tag tag-new">not built</span>
  </button>
  <div class="flow-body">
    <p class="flow-guide">One or two sentences. What this flow is for and what to try clicking.</p>
    <div class="p-states">
      <button data-state="default" class="on">Normal</button>
      <button data-state="empty">Empty</button>
      <button data-state="error">Error</button>
    </div>
    <div class="p-app"> ... the mock ... </div>
    <p class="flow-note">What is proposed here that does not exist yet, or the open question.</p>
  </div>
</section>
```

`flow-tag` is one of `tag-built`, `tag-partial`, `tag-new`.

## Interactivity, all declarative

- `data-acc` on the header. The shell toggles the body. Do not write your own.
- Screens: wrap each screen in `<div class="p-screen" data-screen="name">`. The first one shows. Any element with `data-goto="name"` switches to it. Use this for click-through: card to detail, step to step.
- States: `<div class="p-states"><button data-state="empty">Empty</button></div>` plus `data-when="empty"` on any element makes it visible only in that state. `data-when="default"` for the normal case. Elements with no `data-when` always show.
- `data-toast="Saved to Vault"` on a button pops a toast.
- `data-run="3000"` on a button starts the nearest `.p-progress` bar and advances the nearest `.p-steps`, so sync and generation feel real.
- `data-toggle` flips `.on` on the clicked element. For chips and filters.

Nothing else. No inline handlers, no ids referenced by script.

## Layout

```html
<div class="p-app">                     app frame, sidebar plus main
  <aside class="p-side">
    <div class="p-brand"><i></i>Crowsnest</div>
    <a class="p-nav on">Feed <b>28</b></a>
    <a class="p-nav">Channels</a>
  </aside>
  <div class="p-body">
    <header class="p-top"><h4>Outliers</h4><span class="p-sub">8 posts, 1 channel</span></header>
    <main class="p-main"> ... </main>
  </div>
</div>
```

Use `<div class="p-app p-app--bare">` for a screen with no sidebar (a dialog study, a first run wizard).

## Components

| Class | What it is |
|---|---|
| `p-btn`, `p-btn primary`, `p-btn ghost`, `p-btn danger` | buttons |
| `p-chip`, add `on` | filter chips, toggles |
| `p-card` | bordered surface |
| `p-panel` | inner card with a `p-panel-k` kicker label |
| `p-grid` | responsive video grid |
| `p-vid` | one video card, contains `p-thumb` |
| `p-thumb t1` to `t6` | 9:16 tile, six gradient variants standing in for a real thumbnail |
| `p-score`, add `cold` | outlier multiplier badge |
| `p-dur` | duration stamp, place inside `p-thumb` |
| `p-meta` | caption and stats under a card |
| `p-banner ok|warn|err` | full width status strip |
| `p-steps` with `p-step`, `on`, `done` | stage progress |
| `p-progress` | indeterminate bar, driven by `data-run` |
| `p-table` | plain table |
| `p-field` with `p-label` and `p-input` or `p-select` | form rows |
| `p-empty` | centered empty state, icon plus line plus action |
| `p-skel` | grey skeleton block |
| `p-code` | monospace block for env or JSON |
| `p-split` | two columns, stacks on narrow |
| `p-list` with `p-row` | settings and channel rows |

## Rules

- Real numbers only where they exist. The library has 8 videos from @kallaway (442,447 followers), top score 10.1x at 2,272,877 views, median 224,403. @hormozi has never synced. Do not invent follower counts or view counts for other creators. Use "not synced" and "unknown" where that is the truth.
- Captions can be shortened but must come from the real ones if you show them.
- No em dashes, no en dashes, no curly quotes anywhere, including inside the mock UI text.
- Every flow gets at least two screens or two states. A static picture is not a prototype.
- Keep each panel under roughly 120 lines. Depth comes from clicking, not from length.
