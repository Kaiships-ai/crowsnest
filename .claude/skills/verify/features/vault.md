# Vault

What the operator kept: saved posts, scripts, hooks, and styles.

## Sub-features

- Four tabs, deep-linkable with `?tab=posts|scripts|hooks|styles`, plus `?sort=` and `?q=` search (`src/app/(shell)/(loaded)/vault/page.tsx`).
- Posts tab: rows from `saved_posts`, fed by "Kept" on a feed detail page, with an editable note.
- Hooks and styles: rows from `vault_items`, fed by "Save to Vault" (`save-to-vault-trigger`, `save-to-vault-confirm`).
- Scripts tab: rows from the `scripts` table, opened in a detail dialog. "+ New template" adds one.

## How to get to it (user POV)

Sidebar, Create, Vault (`/vault`).

## Driving it with browse

No journey yet. Run `drive.sh feed-e2e-01` first to keep the seeded outlier, then `browse goto http://localhost:3001/vault?tab=posts` and `browse text`: expect "Saved posts 1" and a `@e2e_fixture_creator` row. `browse goto http://localhost:3001/vault?tab=hooks` on a fresh seed shows "Nothing saved yet." (no hooks and no styles at all); "No hooks saved yet." appears only when styles exist but hooks do not.

## Gotchas

- Tabs and rows carry no `data-testid`, so match on visible text.
- An empty vault on a fresh seed is correct; keep a post first.
