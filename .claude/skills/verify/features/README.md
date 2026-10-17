# crowsnest feature map

One file per user-facing feature. Each names its route, how to drive it with the browse CLI on the verify instance (:3001, seeded `data/e2e.db`), and what proves it works.

| Feature | Route | Journey | File |
|---|---|---|---|
| Feed: filter, open, keep | `/feed`, `/feed/<id>` | `feed-e2e-01` | [feed.md](feed.md) |
| Channels: track a handle (sidecar down) | `/channels` | `ig-sync-e2e-01` | [channels.md](channels.md) |

Other nav routes not yet mapped: `/` (Tuần này), `/channels/discover`, `/runs`, `/logs`, `/settings` (from `src/components/layout/nav-items.ts`).
