# Fix the sidecar's 180 second per request sleep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every Instagram call through the sidecar take about 2 seconds instead of 183, so view count enrichment finishes in seconds and real play counts land in the feed.

**Architecture:** Delete three lines. The sidecar assigns `IG_REQUEST_TIMEOUT_MS` to instagrapi's `request_timeout`, but that field is a sleep before every private request, not an HTTP timeout. Removing the assignment restores instagrapi's default of 1 second. Pacing is already handled by `delay_range = [1, 3]`, set on the same lines.

**Tech Stack:** FastAPI plus instagrapi in `services/ig`, pytest.

## Global constraints

- Do not touch `.env.local`. `IG_REQUEST_TIMEOUT_MS=180000` is a deliberate setting for the TypeScript HTTP timeout and must keep working there.
- No schema change, no migration.
- Commit to `feat/reel-view-count-enrichment` by explicit path.

## The evidence this rests on

`instagrapi/mixins/private.py:434` runs `time.sleep(self.request_timeout)` before every non-login private request. Default is 1 (`instagrapi/__init__.py:114`).

Measured on one reel, same account, same moment:

| request_timeout | Time |
| --- | --- |
| 180 (current) | 182.9s |
| 20 | 21.8 to 23.0s |
| 1 (library default) | 1.9 to 2.2s |

Each is the sleep plus about 2 seconds of real work. Instagram answered in ~2s throughout, so there is no throttling.

The name is the trap. On the TypeScript side `IG_REQUEST_TIMEOUT_MS` is a real HTTP timeout via `AbortSignal.timeout`. On the Python side the same number became a sleep.

---

### Task 1: Stop assigning the TS timeout to instagrapi's sleep

**Files:**
- Modify: `services/ig/crowsnest_ig/session.py` lines 241, 295, 648
- Test: `services/ig/tests/test_session.py` (or the nearest existing session test file)

- [ ] **Step 1: Write the failing test**

The client instagrapi builds must keep the library default, so no long sleep is introduced. Match the file's existing fixture style.

```python
def test_client_does_not_inherit_the_http_timeout_as_a_sleep(monkeypatch, tmp_path):
    """instagrapi's request_timeout is a sleep before every private request
    (mixins/private.py:434), not an HTTP timeout. Assigning IG_REQUEST_TIMEOUT_MS to it
    made every Instagram call sleep 180s, and the session lock serialised them, so a five
    reel enrichment pass took a quarter of an hour."""
    monkeypatch.setenv("IG_REQUEST_TIMEOUT_MS", "180000")
    cfg = load_config()
    assert cfg.request_timeout_ms == 180_000  # still honoured for the HTTP client

    client = SessionManager(cfg)._build_client()
    assert client.request_timeout <= 5, (
        "request_timeout is a per-request sleep; a large value stalls every call"
    )
```

- [ ] **Step 2: Run it and watch it fail**

Run: `services/ig/.venv/bin/python -m pytest services/ig/tests/ -q -k inherit`
Expected: FAIL, `180.0 <= 5` is false.

- [ ] **Step 3: Remove the three assignments**

In `services/ig/crowsnest_ig/session.py`, delete the `client.request_timeout = self.config.request_timeout_s` line at each of the three sites (in `_build_client`, and the two places that re-apply runtime knobs after `load_settings`). Leave `client.delay_range = [1, 3]` alone at all three: that is the real pacing control and it still works.

Add this comment above the surviving `delay_range` line in `_build_client`:

```python
        # delay_range is the pacing control. Deliberately NOT setting
        # client.request_timeout here: despite the name, instagrapi sleeps for that many
        # SECONDS before every private request (mixins/private.py:434), so feeding it
        # IG_REQUEST_TIMEOUT_MS (180000ms) made every call take 183 seconds instead of 2.
        # That variable is the TypeScript side's HTTP timeout and means nothing here.
        client.delay_range = [1, 3]
```

- [ ] **Step 4: Run the test and the whole sidecar suite**

Run: `services/ig/.venv/bin/python -m pytest services/ig/tests/ -q`
Expected: PASS, 163 or more.

- [ ] **Step 5: Prove the speedup for real**

Restart the sidecar in its cmux pane, then time one call:

```bash
TOKEN=$(grep -E "^IG_SERVICE_TOKEN=" .env.local | cut -d= -f2-)
time curl -s -m 60 -X POST -H "X-IG-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"pk":"3953680588034512478"}' http://127.0.0.1:8765/media-stats
```

Expected: a real `play_count` in roughly 2 to 4 seconds, not 183.

- [ ] **Step 6: Commit**

```bash
git add services/ig/crowsnest_ig/session.py services/ig/tests/test_session.py
git commit -m "fix(ig): stop sleeping 180s before every Instagram request"
```

---

### Task 2: Prove a real play count reaches the feed

**Files:** none. Live verification.

- [ ] **Step 1: Record the before state**

```bash
sqlite3 -readonly -header -column data/crowsnest.db "select handle, count(*) clips, sum(case when v.view_count is null then 1 else 0 end) blank from videos v join channels c on c.id=v.channel_id where v.product_type='clips' and v.deleted_at is null and c.handle='@chase.h.ai' group by handle;"
```

- [ ] **Step 2: Run the enrichment against a slow posting channel**

Export the whole env the way `scripts/verify-live.sh:29` does, so the TypeScript side gets the same values Next.js would. `live-sync.ts` does not read `.env.local` on its own, and without this `getOrCreateServiceToken` mints a fresh token and writes it to the secrets table.

```bash
set -a; . ./.env.local; set +a
VIEW_COUNT_ENRICH_PER_CHANNEL=5 npx tsx scripts/live-sync.ts @chase.h.ai
```

Use `@chase.h.ai` or `@kallaway`, not `@hormozi`. Hormozi posts several times a day and its newest reels are hours old.

- [ ] **Step 3: Confirm real numbers landed**

```bash
sqlite3 -readonly -header -column data/crowsnest.db "select c.handle, v.external_id, v.view_count, v.outlier_score, substr(v.last_refreshed_at,1,16) refreshed from videos v join channels c on c.id=v.channel_id where c.handle='@chase.h.ai' and v.view_count is not null order by v.last_refreshed_at desc limit 6;"
```

Expected: non-null `view_count` on a tracked channel other than @kallaway, which has never been true in this database, plus a non-null `outlier_score`. Five enriched reels meets the `scoreMinUsablePosts` floor of 5, so a baseline computes.

- [ ] **Step 4: Report the actual numbers**

Report the play counts, the outlier scores, and the wall clock time of the enrichment pass. Do not claim the feature works without pasting the numbers.

## Self review

Spec coverage: the single root cause is Task 1 Step 3, its regression guard is Step 1, and the end to end proof is Task 2. No placeholders. `request_timeout` and `delay_range` are named identically everywhere they appear.

Known risk: `request_timeout` is also used as a genuine HTTP timeout on instagrapi's public request paths (`mixins/public.py:203`, `mixins/user.py:134`), so dropping to the default of 1 gives those a 1 second timeout. The sidecar's calls are private (`media_info_v1`, `user_medias_paginated_v1`), and asset downloads use their own `download_timeout_s`, so no current path relies on the public timeout. If a public path is added later it needs its own value, not this one.
