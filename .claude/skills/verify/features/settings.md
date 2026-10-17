# Settings and incident log

Cài đặt at `/settings`, and its second tab Nhật ký sự cố: the log at `/logs` and runs at `/runs`.

## Sub-features

- Tabs (`src/components/layout/section-tabs.tsx`): `settings-tab-config` "Cấu hình", `settings-tab-incidents` "Nhật ký sự cố" (to `/logs`). Inside the incident log: `incidents-tab-logs` "Log", `incidents-tab-runs` "Lần chạy".
- `/settings`: a stack health panel, then sections with anchors `#instagram`, `#accounts`, `#graph-api`, `#scoring`, `#feed-defaults`, `#api-keys`, `#local-binaries`, `#sync`, `#runs-alerts`, `#publish`, `#onboarding`, `#appearance`.
- Graph card `settings-graph-card` "Instagram Graph API" with `mine-connect-check`; after a check, `mine-connect-checked` reads "last checked ...".
- Secrets rows: `secrets-<slug>-badge` ("Configured" or "Not set") and `secrets-<slug>-edit` ("Set" or "Replace"), e.g. `secrets-ig-graph-token-badge`. Values never reach the browser.
- `/logs`: a level, source, and time filter over `log_events` (query params `levels`, `source`, `event`, `since`, `until`, `search`). Empty: "No log events match this filter."
- `/runs`: "N runs" and the runs table. Empty: "No runs yet."

## How to get to it (user POV)

Sidebar, Cài đặt. The Cài đặt item stays active on `/settings`, `/logs`, and `/runs`.

## Driving it with browse

No journey script. On a fresh seed:

```bash
$B goto http://localhost:3001/settings
$B js 'document.querySelector("[data-testid=secrets-ig-graph-token-badge]").innerText'   # Configured
$B click '[data-testid="mine-connect-check"]'      # junk token: the check fails, graph-token-line appears elsewhere
$B click '[data-testid="settings-tab-incidents"]'  # URL /logs, rows such as graph.request.error
$B click '[data-testid="incidents-tab-runs"]'      # "0 runs", "No runs yet."
```

Proof: `sqlite3 data/e2e.db "select event from log_events order by id desc limit 5"` names the events the log table shows.

## Gotchas

- The seed stores `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, and `IG_SERVICE_TOKEN` in `secrets`, so those badges read Configured and a `secrets` row beats the server env.
- The health panel probes the IG sidecar's `/health` on :8765. When the operator's sidecar is up, the verify instance logs `ig.request.error` 401 `IG_SERVICE_UNAUTHORIZED` (the seed's token is junk). It is a read-only health call; nothing reaches Instagram.
- Graph calls from the verify instance are answered by `scripts/e2e/graph-offline.mjs` (`up.sh` preloads it), so a check logs `graph.request.error` with kind auth and no network call.
