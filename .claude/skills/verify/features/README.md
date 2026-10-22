# crowsnest feature map

One file per user-facing feature. Each names its route, how to drive it with the browse CLI on the verify instance (:3001, seeded `data/e2e.db`), and what proves it works.

Navigation (`src/components/layout/nav-items.ts`) is exactly three items: Tuần này (`/`), Nguồn (`/feed`, with tabs Feed, Kênh `/channels`, Khám phá `/channels/discover`), and Cài đặt (`/settings`, with Nhật ký sự cố at `/logs` and `/runs`).

| Feature | Route | Journey | File |
|---|---|---|---|
| Week: today, move, drawer, publish gate, funnel, plan draft | `/` | none, ad hoc | [week.md](week.md) |
| Feed: filter, open, keep | `/feed`, `/feed/<id>` | `feed-e2e-01` | [feed.md](feed.md) |
| Channels and Discover: track a handle (sidecar down) | `/channels`, `/channels/discover` | `ig-sync-e2e-01` | [channels.md](channels.md) |
| Settings and incident log | `/settings`, `/logs`, `/runs` | none, ad hoc | [settings.md](settings.md) |

Removed pages redirect with 307: `/persona`, `/ideas`, `/vault`, `/mine` (and any subpath) go to `/`, `/sources` goes to `/feed` (`next.config.ts`), and any `/?tab=` goes to `/` (`src/proxy.ts`). There is no `/dashboard` route; it answers 404. Check them with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3001/vault/x`.
