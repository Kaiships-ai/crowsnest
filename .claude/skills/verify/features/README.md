# crowsnest feature map

One file per user-facing feature. Each names its route, how to drive it with the browse CLI on the verify instance (:3001, seeded `data/e2e.db`), and what proves it works.

| Feature | Route | Journey | File |
|---|---|---|---|
| Feed: filter, open, keep | `/feed`, `/feed/<id>` | `feed-e2e-01` | [feed.md](feed.md) |
| My channel: plan a post on the calendar | `/mine` | `mine-e2e-02` | [mine.md](mine.md) |
| Channels: track a handle (sidecar down) | `/channels` | `ig-sync-e2e-01` | [channels.md](channels.md) |
| Vault: saved posts | `/vault` | none yet | [vault.md](vault.md) |

Other nav routes not yet mapped: `/` (Dashboard), `/ideas`, `/channels/discover`, `/runs`, `/logs`, `/persona`, `/settings` (from `src/components/layout/nav-items.ts`).
