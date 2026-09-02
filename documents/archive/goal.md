Ship a production-ready Instagram channel sync. You are tech lead: recon → propose → get my
approval → build → prove. Use sub-agents (hard/correctness-critical → strongest model available,
implementation → mid, spec-checklist review → small; verify real model IDs before dispatching).

## Goal
Sync a channel's profile + all media from the **last 30 days** (`LOOKBACK_DAYS` env, hard cap
`MAX_ITEMS_PER_SYNC`), and display real thumbnails and playable videos. Replace Apify entirely with
instagrapi (https://subzeroid.github.io/instagrapi/). Remove all seed data.

## Rules
1. **Never fake.** If something can't be made to work for real, STOP and report it. No mock data, no
   placeholder images, no `catch → return []`, no dev-only fake branches, no hardcoded metrics. An
   undisclosed gap fails the whole task; a disclosed one doesn't.
2. **Evidence or it's not done.** Every completion claim needs pasted command output, real DB rows,
   real byte sizes, or a screenshot.
3. **No descoping.** Blocked → escalate to a stronger model or split the task. Never drop a feature.
4. **Don't guess the repo.** Recon first: stack, run/test commands, existing data model, storage
   layer, every Apify call site, every seed/mock location.

## Constraints you won't discover on your own
- **Instagram CDN URLs are signed and expire in hours.** Storing a URL and rendering it in `<img>`
  is an automatic fail. Download assets to your own storage and serve them from your own endpoint.
- **Video needs HTTP Range support** (206 responses) or seeking is broken.
- **instagrapi is Python.** If the app isn't, the service boundary is a real design decision — put it
  in the design brief with alternatives considered.
- **instagrapi uses Instagram's private API**: against Meta's ToS, accounts get challenged/banned.
  Session persistence, 2FA + challenge handling, rate limiting with jitter, proxy support, pinned
  device profile are all required — not optional hardening. Document the risk in the README. If we
  own the target accounts, evaluate the official Graph API and say why you chose otherwise.
- **Private API drift:** pin the instagrapi version, keep the raw payload, tolerate new/missing
  optional fields but fail loudly on missing required ones.

## Gate 1 — design brief (stop here for my approval)
One file, no code yet: recon findings, data model, service boundary + alternatives rejected, media
storage & video-download policy (eager vs on-demand, retention), sync scheduling + concurrency lock,
error taxonomy, env schema, open questions. Ask me at most 5 blocking questions in one batch;
document other assumptions and proceed.

## Gate 2 — build
Idempotent upsert keyed on media pk; incremental sync stopping at the lookback boundary; carousels as
children (not one image); soft-mark deleted posts; per-asset failure isolated; timeouts on every
outbound call; typed errors; structured logs; migrations from an empty DB; config validated at boot
(refuse to start on missing env); real loading/empty/error/in-progress UI states.

## Gate 3 — proof (paste evidence for each)
1. Clean clone → documented setup → boots
2. Migrations run on an empty DB
3. Live sync of a real channel: sync-log row with `items_seen > 0`, status success
4. DB rows with real captions and real `taken_at`; `min(taken_at) >= now() - 30 days`; newest live
   post present
5. Assets on disk with non-zero sizes (`ls -la`)
6. `curl -I` → 200; `curl -H 'Range: bytes=0-1023' -i` → **206**
7. Zero `cdninstagram.com` URLs in any API response or the DOM
8. Screenshots: grid, playing video, carousel, real empty state
9. Second consecutive sync → `items_created = 0`, no duplicates
10. Logs showing recovery from an invalidated session and from a rate-limit backoff
11. `rg -i 'apify|actor_id|apify_token' --glob '!.git' .` → zero
12. `rg -i 'mock|seed|lorem|placeholder|dummy|faker|placehold\.co|picsum' --glob '!tests/**' --glob '!**/*.test.*' src/` → zero, or each hit justified in writing
13. Lint + typecheck + build + tests green (including a live integration test and one E2E asserting a
    real thumbnail and a real video byte-stream)

## Gate 4 — adversarial audit
Fresh sub-agent, strongest model, hunts specifically for: mock residue, swallowed exceptions,
hardcoded values, CDN URLs leaking to the client, missing timeouts, sync race conditions, and weak or
fabricated evidence above. It reviews only — it doesn't fix. Its findings are either fixed or
surfaced to me.

## Final report
What works end to end · the 13 proofs · what I removed (with gate output) · how to deploy, configure,
run a sync, and recover from an auth challenge · **known limitations and anything I could not
verify** · recommended follow-ups.
