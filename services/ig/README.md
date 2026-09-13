# crowsnest-ig — Instagram sidecar

A localhost-only FastAPI service holding **one** long-lived authenticated
[`instagrapi`](https://github.com/subzeroid/instagrapi) client. The Next.js app
talks to it over HTTP; it never sees an Instagram CDN URL that it did not ask
for, and it never sees a Python traceback — only the typed error envelope below.

Design contract: [`docs/design/instagram-sync-brief.md`](../../docs/design/instagram-sync-brief.md)
(§3 service boundary, §5 media storage, §7 error taxonomy, §8 env schema).

---

## ⚠️ Terms-of-Service and ban risk — read this first

**instagrapi drives Instagram's private mobile API. Using it is against
Instagram's Terms of Use, and the account you log in with can be rate-limited,
challenged, or permanently disabled. There is no configuration of this service
that removes that risk.**

Why it is here anyway, stated plainly:

- Instagram's **Basic Display API was shut down on 2024-12-04**.
- The remaining official surface, the **Graph API**, only exposes media for
  accounts *you own* (Business/Creator + linked Facebook Page + App Review).
  Its business-discovery lookup returns coarse public counters for other
  accounts and **cannot enumerate an arbitrary creator's media**.
- Crowsnest exists to analyse *other* creators' reels — accounts we do not own
  and cannot get to authorize us. The official API structurally cannot serve
  this product.

So this is a **disclosed** trade-off, not a hidden one.

What follows from that:

1. **Use a burner account.** Never the account you care about. Assume it will
   eventually be challenged or disabled.
2. **Anonymous access does not work.** Verified against live Instagram:
   `Client().user_info_by_username_gql("kallaway")` →
   `ClientBadRequestError: 400 ... /api/v1/users/web_profile_info/`. A logged-in
   account is mandatory; there is no read-only fallback.
3. Mitigations this service implements — none of which are guarantees:
   pinned device profile + deterministic uuids, session reuse across restarts,
   `delay_range = [1, 3]` jitter between requests, exponential backoff with a
   cooldown that survives a restart, optional proxy, low request volume.
4. Credentials live in `.env.local` (gitignored). They are never logged; the
   structured logger redacts `password`, `verification_code`, `security_code`,
   `authorization_data` and `cookies`.
5. The session blob at `IG_SESSION_PATH` is written **mode 0600** and is a
   password-equivalent secret. `data/` is gitignored.

---

## Install and run

Requires [`uv`](https://docs.astral.sh/uv/). Python 3.12 is pinned — 3.13/3.14
are **not** supported by this dependency set.

```bash
cd services/ig
uv sync                      # creates .venv, installs the locked deps
uv run pytest                # offline unit tests, no network
```

**Normal way to run it — from the repo root:**

```bash
npm run ig:service
```

That wrapper (`scripts/ig-service.sh`) loads `.env.local` and then execs the module.
This matters: Next.js reads `.env.local` automatically, but this is a separate Python
process and does not. Running `uv run python -m crowsnest_ig` directly with credentials
sitting only in `.env.local` fails at boot with "IG_SERVICE_TOKEN is required" — the app
and the sidecar would be reading two different environments.

Variables already exported in your shell take precedence, so one-off overrides work:

```bash
IG_PROXY='socks5://user:pass@host:1080' npm run ig:service
LOG_LEVEL=debug npm run ig:service
```

**Running the module directly** (no `.env.local` loading) is still supported when you
want to be explicit:

```bash
export IG_SERVICE_TOKEN='<16+ chars, shared with Node>'
export IG_USERNAME='burner_account'
export IG_PASSWORD='...'
uv run python -m crowsnest_ig
```

It binds `127.0.0.1:8765` only. A non-loopback `IG_SERVICE_HOST` is refused at
boot.

### First login

```bash
T='<IG_SERVICE_TOKEN>'
curl -s localhost:8765/health -H "X-IG-Token: $T"
curl -s -XPOST localhost:8765/login -H "X-IG-Token: $T" \
     -H 'content-type: application/json' -d '{}'
```

`/login` returns one of:

| `status` | what to do |
|---|---|
| `ok` | done; the session blob is persisted |
| `two_factor_required` | `POST /two-factor {"code": "123456"}` |
| `challenge_required`, `stage: "choice"` | `POST /challenge/resolve {"choice": "email"\|"sms"}` — the offered channels are in `channels` |
| `challenge_required`, `stage: "code"` | `POST /challenge/resolve {"code": "123456"}` |

The login runs on a worker thread that **parks** at each point where Instagram
wants human input, so a challenge is a sequence of HTTP round-trips rather than
a blocking terminal prompt. A parked login waits 5 minutes for input before it
gives up with `IG_CHALLENGE`.

---

## Environment

| Var | Required | Default | Meaning |
|---|---|---|---|
| `IG_SERVICE_TOKEN` | **yes** | — | shared secret; every request needs `X-IG-Token`. Min 16 chars. |
| `IG_USERNAME` | for login | — | Instagram login (service still boots without it and serves `/health`) |
| `IG_PASSWORD` | for login | — | must be set together with `IG_USERNAME` |
| `IG_SESSION_PATH` | no | `data/ig-session.json` | persisted session blob, mode 0600 |
| `IG_PROXY` | no | — | e.g. `http://user:pass@host:port` |
| `IG_DEVICE_SEED` | no | derived from username | pins the device profile + uuids |
| `MEDIA_ROOT` | no | `data/media` | content-addressed asset root |
| `IG_SERVICE_HOST` | no | `127.0.0.1` | loopback only; anything else is refused |
| `IG_SERVICE_PORT` | no | `8765` | |
| `IG_REQUEST_TIMEOUT_MS` | no | `30000` | per Instagram API call |
| `IG_DOWNLOAD_TIMEOUT_MS` | no | `120000` | per asset download |

Relative paths resolve against the repo root, not the CWD. Every variable is
validated once at boot; the process exits `78` (`EX_CONFIG`) on a bad value
rather than starting half-configured.

---

## API

Every endpoint requires `X-IG-Token`. Every failure is
`4xx`/`5xx` with:

```json
{"error": {"code": "IG_...", "message": "...", "retryable": true, "detail": {}}}
```

### `GET /health`
Works when **not** logged in (HTTP 200, `logged_in: false`) — Node uses it as a
liveness probe.
```json
{"status":"ok","logged_in":false,"username":null,"instagrapi_version":"2.18.9",
 "session_loaded":false,"session_path":"...","media_root":"...",
 "can_login":false,"cooldown_until":null}
```

### `POST /login` · `POST /challenge/resolve` · `POST /two-factor` · `POST /logout`
See "First login" above. `/logout` deletes the session blob and the cooldown
file and drops the in-memory client.

### `GET /profile?handle=`
`ProfileDTO` + `raw` (the untouched instagrapi dict, for drift forensics).
A pasted profile URL is **rejected** (`IG_BAD_REQUEST`), not silently accepted.

### `GET /medias?handle=&since_iso=&max_items=&cursor=`
One newest-first page:
```json
{"items": [MediaDTO], "next_cursor": "...", "stop_reason": "lookback|cap|exhausted|page"}
```
- Carousels come back as **one** item with `children: [{position, pk, media_type,
  thumbnail_url, video_url, raw}]` in payload order. A `Resource` has no
  `taken_at` and no caption — the consumer inherits both from the parent; this
  service does not invent them.
- The `since_iso` boundary does **not** stop on the first out-of-window item.
  Pinned posts appear first and out of chronological order, so the walk stops
  only after **3 consecutive** out-of-window items, and an item detected as
  pinned never counts toward that streak (brief §6).
- Paging carries two extra query params so the rule survives a page boundary:
  `already_kept` and `out_of_window_streak` (both default `0`). Pass back what
  you have accumulated; `next_cursor` is `null` whenever `stop_reason` is
  `lookback` or `exhausted` (the window, or the account's media, is fully
  enumerated). A `cap` stop is not terminal the same way: it means the
  caller's `max_items` budget ran out partway through this raw page, not that
  the raw page was the last one, so `next_cursor` still carries the real
  cursor to the next raw page. A caller whose budget is smaller than one raw
  page must use it to resume, or it strands that page's own un-kept tail
  forever (crowsnest ig-sync PERF-2).

### `POST /resolve-media` `{pk}`
Re-resolves a single media's **current** `video_url` / `thumbnail_url` (+
children). Instagram's CDN URLs expire, and video download is on-demand, so this
is what the first-playback path calls before downloading.

### `POST /download` `{url, kind, media_pk?}`
`kind` ∈ `thumbnail | video | avatar`. Downloads into `MEDIA_ROOT` and returns:
```json
{"path":"ab/abcd...ef.jpg","bytes":41283,"content_type":"image/jpeg",
 "sha256":"abcd...ef","width":640,"height":640,"duration_sec":null,"deduped":false}
```
- **Content-addressed**: `<sha256[0:2]>/<sha256>.<ext>`, relative to
  `MEDIA_ROOT`. The path derives from the hash alone, so a hostile URL cannot
  steer a write outside the root.
- Re-downloading identical bytes **dedupes** onto the same file and returns
  `deduped: true`.
- A **zero-byte** download is an `IG_ASSET_DOWNLOAD` error, never a success.
- Bytes land in `MEDIA_ROOT/.tmp` first, so an interrupted transfer never leaves
  a truncated file at a content-addressed path a later run would trust.
- `width`/`height` come from Pillow for images. `duration_sec` comes from
  `ffprobe` **when it is on `PATH`**; otherwise it is `null` — not guessed.

---

## Error codes

| Code | From | Retryable | HTTP |
|---|---|---|---|
| `IG_AUTH_REQUIRED` | `LoginRequired`, `ClientLoginRequired`, `ReloginAttemptExceeded` | yes (after re-login) | 401 |
| `IG_BAD_CREDENTIALS` | `BadPassword`, `BadCredentials`, `AccountSuspended` | no | 401 |
| `IG_TWO_FACTOR` | `TwoFactorRequired` | no (needs input) | 401 |
| `IG_CHALLENGE` | `ChallengeRequired`, `CaptchaChallengeRequired`, `ChallengeSelfieCaptcha`, `ChallengeUnknownStep`, … | no (needs input) | 401 |
| `IG_RATE_LIMITED` | `FeedbackRequired`, `PleaseWaitFewMinutes`, `RateLimitError`, `ClientThrottledError`, `SentryBlock` | yes, backoff | 429 |
| `IG_NOT_FOUND` | `UserNotFound`, `MediaNotFound`, `MediaUnavailable` | no | 404 |
| `IG_PRIVATE` | `PrivateAccount` | no | 403 |
| `IG_PROXY_BLOCKED` | `ProxyAddressIsBlocked` | no | 502 |
| `IG_NETWORK` | `ClientConnectionError`, `ClientRequestTimeout`, unclassified `ClientError` | yes | 503 |
| `IG_ASSET_DOWNLOAD` | `VideoNotDownload`, HTTP failure, zero bytes | yes | 502 |
| `IG_DRIFT` | required field missing / wrong type | no | 500 |
| `IG_BAD_REQUEST` | bad handle, bad `since_iso`, bad payload | no | 400 |
| `IG_UNAUTHORIZED` | missing or wrong `X-IG-Token` | no | 401 |
| `IG_INTERNAL` | a bug in this service | no | 500 |

**Drift policy.** `pk`, `code`, `taken_at`, `media_type` are required; missing or
mistyped → `IG_DRIFT` with the raw payload in `detail.raw`. Unknown/new fields
are ignored. Absent optional fields become `null`. instagrapi is pinned to
`==2.18.9` precisely so drift is a decision, not a surprise.

---

## Hardening

**Session persistence.** `dump_settings` / `load_settings` at `IG_SESSION_PATH`,
created mode 0600 *before* anything is written to it. Loaded on startup; an
unreadable blob logs `session.load_failed` and the service continues
unauthenticated rather than pretending.

**Device pinning.** `IG_DEVICE_SEED` (default `crowsnest:<username>`) drives a
SHA-256-derived device profile and all seven uuids, so the same account always
presents the same phone across restarts even if the session blob is lost.

**Session recovery.** On `LoginRequired`/`ClientLoginRequired` during any call:
exactly one re-login using the stored settings, then the call is retried once.
A second failure is `IG_AUTH_REQUIRED`. Both halves are logged:

```
session.invalidated → [session.recovery_settings_unreadable] → session.persisted
                    → session.recovered → session.retry_succeeded
```
or `session.recovery_failed` on the escalation path.

**Rate limiting.** `delay_range = [1, 3]` jitter between requests. On a
throttle: full-jitter exponential backoff, base 60s, cap 30min, max 5 attempts,
each decision logged as `ratelimit.backoff` and persisted as a cooldown deadline
next to the session file, so a restart does not immediately hammer Instagram.

> **Judgement call.** The backoff is *not* slept inside the HTTP request. Node
> calls this service with a 30s `AbortSignal`; sleeping 60s–30min in-request
> would guarantee a client-side timeout and hide the real cause. The service
> returns `IG_RATE_LIMITED` with `detail.retry_after_sec`, `detail.attempt` and
> `detail.cooldown_until`, and refuses further Instagram traffic until the
> deadline passes. The attempt counter is persisted, so successive rate-limited
> calls escalate 1→5 exactly as the brief specifies.

**Concurrency.** instagrapi's `Client` is not thread-safe; every call goes
through one re-entrant lock. The challenge broker sits deliberately *outside*
that lock so a parked login can still be fed a code by a second request.

---

## Logs

One JSON object per line on stdout. Useful events:

`service.starting` `service.ready` `session.device_pinned` `session.loaded`
`session.absent` `session.load_failed` `session.persisted` `session.invalidated`
`session.recovered` `session.retry_succeeded` `session.recovery_failed`
`ratelimit.backoff` `ratelimit.cooldown_set` `challenge.choice_required`
`challenge.code_required` `login.started` `login.succeeded` `login.failed`
`medias.page` `asset.stored` `asset.deduped` `download.completed`
`request.failed`

```bash
uv run python -m crowsnest_ig | jq -c 'select(.event | startswith("session."))'
```

---

## Tests

`uv run pytest` — 150+ offline unit tests, **no network**. They cover config
validation and boot refusal, the full instagrapi-exception → error-code
taxonomy, the mapper and its drift policy, carousel children and positions, the
3-consecutive lookback boundary (including pinned items and page carry-over),
content-addressed storage / dedupe / zero-byte rejection, backoff bounds and
cooldown persistence, device determinism, token auth on every endpoint, and
session recovery with its log evidence.

**Not covered offline, and honestly so:** anything that needs a real Instagram
login — a real `/login`, a real challenge or 2FA round-trip, a real `/profile`
or `/medias` response, a genuine Instagram-issued rate limit, and a real CDN
asset download. Those are live steps for whoever holds the burner credentials.
The `select_verify_method` SMS-preference branch in
`CrowsnestClient.challenge_resolve_simple` in particular has never been executed
against Instagram.
