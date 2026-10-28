"""Error taxonomy — brief §7.

Every failure that leaves this service does so as an ``IgError`` and is rendered
as::

    {"error": {"code": "IG_...", "message": "...", "retryable": bool, "detail": {}}}

Node depends on this exact shape. There is no code path that turns a failure
into an empty success.
"""

from __future__ import annotations

from typing import Any

from instagrapi import exceptions as ig_ex

# --------------------------------------------------------------------------
# Codes
# --------------------------------------------------------------------------
IG_AUTH_REQUIRED = "IG_AUTH_REQUIRED"
IG_BAD_CREDENTIALS = "IG_BAD_CREDENTIALS"
IG_TWO_FACTOR = "IG_TWO_FACTOR"
IG_CHALLENGE = "IG_CHALLENGE"
IG_RATE_LIMITED = "IG_RATE_LIMITED"
IG_NOT_FOUND = "IG_NOT_FOUND"
# A 404 that came from routing, not from Instagram: the caller asked for a path this
# process does not serve. Distinct from IG_NOT_FOUND on purpose, because the two are
# indistinguishable by status code and mean opposite things. IG_NOT_FOUND is a fact about
# Instagram that a caller can reasonably skip past; this one means the sidecar is older
# than the client calling it, and every subsequent call to that path will fail the same
# way. Conflating them let a stale sidecar report "every reel is missing" instead of
# "that endpoint does not exist here".
IG_ROUTE_NOT_FOUND = "IG_ROUTE_NOT_FOUND"
IG_PRIVATE = "IG_PRIVATE"
IG_PROXY_BLOCKED = "IG_PROXY_BLOCKED"
IG_NETWORK = "IG_NETWORK"
IG_ASSET_DOWNLOAD = "IG_ASSET_DOWNLOAD"
IG_DRIFT = "IG_DRIFT"
IG_BAD_REQUEST = "IG_BAD_REQUEST"
IG_UNAUTHORIZED = "IG_UNAUTHORIZED"
IG_INTERNAL = "IG_INTERNAL"

# code -> (http status, retryable)
_CODE_META: dict[str, tuple[int, bool]] = {
    IG_AUTH_REQUIRED: (401, True),
    IG_BAD_CREDENTIALS: (401, False),
    IG_TWO_FACTOR: (401, False),
    IG_CHALLENGE: (401, False),
    IG_RATE_LIMITED: (429, True),
    IG_NOT_FOUND: (404, False),
    IG_ROUTE_NOT_FOUND: (404, False),
    IG_PRIVATE: (403, False),
    IG_PROXY_BLOCKED: (502, False),
    IG_NETWORK: (503, True),
    IG_ASSET_DOWNLOAD: (502, True),
    IG_DRIFT: (500, False),
    IG_BAD_REQUEST: (400, False),
    IG_UNAUTHORIZED: (401, False),
    IG_INTERNAL: (500, False),
}


class IgError(Exception):
    """A typed, wire-serialisable failure."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool | None = None,
        status_code: int | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        if code not in _CODE_META:
            raise ValueError(f"unknown error code {code!r}")
        default_status, default_retryable = _CODE_META[code]
        self.code = code
        self.message = message
        self.retryable = default_retryable if retryable is None else retryable
        self.status_code = default_status if status_code is None else status_code
        self.detail: dict[str, Any] = detail or {}

    def to_body(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "detail": self.detail,
            }
        }


class DriftError(IgError):
    """Required field missing or of the wrong type. Fails loudly, raw attached."""

    def __init__(self, message: str, raw: Any, *, field: str | None = None) -> None:
        super().__init__(
            IG_DRIFT,
            message,
            detail={"field": field, "raw": _truncate(raw)},
        )


def _truncate(raw: Any, limit: int = 8000) -> Any:
    """Keep raw payloads useful without letting a log line become a novel."""
    text = repr(raw)
    if len(text) <= limit:
        return raw
    return {"truncated": True, "repr": text[:limit]}


# --------------------------------------------------------------------------
# instagrapi exception -> code
# --------------------------------------------------------------------------
# Ordered most-specific first; the first isinstance() hit wins. Order matters
# because e.g. UserNotFound subclasses PrivateError, and ChallengeRequired
# subclasses ChallengeError.
_RULES: list[tuple[tuple[type[BaseException], ...], str]] = [
    ((ig_ex.TwoFactorRequired,), IG_TWO_FACTOR),
    (
        (
            ig_ex.ChallengeRequired,
            ig_ex.CaptchaChallengeRequired,
            ig_ex.ChallengeSelfieCaptcha,
            ig_ex.ChallengeUnknownStep,
            ig_ex.ChallengeRedirection,
            ig_ex.RecaptchaChallengeForm,
            ig_ex.SelectContactPointRecoveryForm,
            ig_ex.SubmitPhoneNumberForm,
            ig_ex.ChallengeError,
        ),
        IG_CHALLENGE,
    ),
    ((ig_ex.BadPassword, ig_ex.BadCredentials, ig_ex.AccountSuspended), IG_BAD_CREDENTIALS),
    (
        (ig_ex.LoginRequired, ig_ex.ClientLoginRequired, ig_ex.ReloginAttemptExceeded),
        IG_AUTH_REQUIRED,
    ),
    (
        (
            ig_ex.FeedbackRequired,
            ig_ex.PleaseWaitFewMinutes,
            ig_ex.RateLimitError,
            ig_ex.ClientThrottledError,
            ig_ex.SentryBlock,
        ),
        IG_RATE_LIMITED,
    ),
    ((ig_ex.PrivateAccount,), IG_PRIVATE),
    (
        (ig_ex.UserNotFound, ig_ex.MediaNotFound, ig_ex.MediaUnavailable, ig_ex.NotFoundError),
        IG_NOT_FOUND,
    ),
    ((ig_ex.ProxyAddressIsBlocked,), IG_PROXY_BLOCKED),
    (
        (ig_ex.ClientConnectionError, ig_ex.ClientRequestTimeout, ig_ex.ClientIncompleteReadError),
        IG_NETWORK,
    ),
    ((ig_ex.VideoNotDownload, ig_ex.AlbumNotDownload), IG_ASSET_DOWNLOAD),
]

_MESSAGES: dict[str, str] = {
    IG_AUTH_REQUIRED: "Instagram session expired — re-authenticate.",
    IG_BAD_CREDENTIALS: "Instagram rejected the credentials.",
    IG_TWO_FACTOR: "Instagram requires a two-factor code.",
    IG_CHALLENGE: "Instagram issued a challenge that needs manual resolution.",
    IG_RATE_LIMITED: "Instagram is throttling this account.",
    IG_NOT_FOUND: "Instagram has no such user or media.",
    IG_ROUTE_NOT_FOUND: "This sidecar does not serve that path; it is probably older than the app calling it.",
    IG_PRIVATE: "That Instagram account is private.",
    IG_PROXY_BLOCKED: "The configured proxy address is blocked by Instagram.",
    IG_NETWORK: "Network failure talking to Instagram.",
    IG_ASSET_DOWNLOAD: "Asset download failed.",
}


def classify(exc: BaseException) -> str:
    """Map an instagrapi (or stdlib network) exception onto a stable code."""
    for types, code in _RULES:
        if isinstance(exc, types):
            return code
    # requests/urllib3 timeouts surface as themselves when we drive HTTP directly.
    name = type(exc).__name__
    if name in {"ConnectTimeout", "ReadTimeout", "Timeout", "ConnectionError", "ChunkedEncodingError"}:
        return IG_NETWORK
    if isinstance(exc, ig_ex.ClientUnauthorizedError) or (
        isinstance(exc, ig_ex.ClientError) and "login_required" in str(exc)
    ):
        # An expired session often reaches us as a bare ClientError("login_required")
        # rather than LoginRequired. The user can fix it by logging in again; a network
        # code would tell them to wait.
        return IG_AUTH_REQUIRED
    if isinstance(exc, ig_ex.ClientError):
        # A ClientError we have no specific rule for is still an upstream fault,
        # not a success. Surface it as a network-class problem, never swallow it.
        return IG_NETWORK
    return IG_INTERNAL


def translate(exc: BaseException, *, detail: dict[str, Any] | None = None) -> IgError:
    """Convert any exception into an IgError. Never returns a fake success."""
    if isinstance(exc, IgError):
        if detail:
            exc.detail = {**exc.detail, **detail}
        return exc
    code = classify(exc)
    upstream = str(exc) or type(exc).__name__
    message = _MESSAGES.get(code, upstream)
    merged: dict[str, Any] = {
        "exception": type(exc).__name__,
        "upstream_message": upstream,
    }
    if detail:
        merged.update(detail)
    return IgError(code, message, detail=merged)
