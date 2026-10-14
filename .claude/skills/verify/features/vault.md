# Vault

Saved posts and saved hooks/styles.

## Sub-features

- Saved posts list, fed by "Kept" on a feed detail page.
- Hooks and styles, fed by "Save to Vault".

## How to get to it (user POV)

Sidebar, Create, Vault (`/vault`).

## Driving it with browse

No journey yet. Run `drive.sh feed-e2e-01` first to keep the seeded outlier, then `browse goto http://localhost:3001/vault`, `browse text`, and expect the `@e2e_fixture_creator` post to be listed.

## Gotchas

- An empty vault on a fresh seed is correct; keep a post first.
