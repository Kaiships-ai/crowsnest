from __future__ import annotations

import pytest
from instagrapi import exceptions as ig_ex

from crowsnest_ig import errors
from crowsnest_ig.errors import IgError, classify, translate

# Brief §7, row for row.
CASES = [
    (ig_ex.LoginRequired, errors.IG_AUTH_REQUIRED),
    (ig_ex.ClientLoginRequired, errors.IG_AUTH_REQUIRED),
    (ig_ex.ReloginAttemptExceeded, errors.IG_AUTH_REQUIRED),
    (ig_ex.BadPassword, errors.IG_BAD_CREDENTIALS),
    (ig_ex.BadCredentials, errors.IG_BAD_CREDENTIALS),
    (ig_ex.AccountSuspended, errors.IG_BAD_CREDENTIALS),
    (ig_ex.TwoFactorRequired, errors.IG_TWO_FACTOR),
    (ig_ex.ChallengeRequired, errors.IG_CHALLENGE),
    (ig_ex.CaptchaChallengeRequired, errors.IG_CHALLENGE),
    (ig_ex.ChallengeSelfieCaptcha, errors.IG_CHALLENGE),
    (ig_ex.ChallengeUnknownStep, errors.IG_CHALLENGE),
    (ig_ex.FeedbackRequired, errors.IG_RATE_LIMITED),
    (ig_ex.PleaseWaitFewMinutes, errors.IG_RATE_LIMITED),
    (ig_ex.RateLimitError, errors.IG_RATE_LIMITED),
    (ig_ex.ClientThrottledError, errors.IG_RATE_LIMITED),
    (ig_ex.SentryBlock, errors.IG_RATE_LIMITED),
    (ig_ex.UserNotFound, errors.IG_NOT_FOUND),
    (ig_ex.MediaNotFound, errors.IG_NOT_FOUND),
    (ig_ex.MediaUnavailable, errors.IG_NOT_FOUND),
    (ig_ex.PrivateAccount, errors.IG_PRIVATE),
    (ig_ex.ProxyAddressIsBlocked, errors.IG_PROXY_BLOCKED),
    (ig_ex.ClientConnectionError, errors.IG_NETWORK),
    (ig_ex.ClientRequestTimeout, errors.IG_NETWORK),
    (ig_ex.VideoNotDownload, errors.IG_ASSET_DOWNLOAD),
]


@pytest.mark.parametrize("exc_type,expected", CASES, ids=[c[0].__name__ for c in CASES])
def test_taxonomy(exc_type: type[BaseException], expected: str) -> None:
    assert classify(exc_type("boom")) == expected


def test_two_factor_beats_bad_password_ordering() -> None:
    # TwoFactorRequired and BadPassword are siblings under PrivateError; the
    # rule order must not let a 2FA prompt be reported as bad credentials.
    assert classify(ig_ex.TwoFactorRequired("2fa")) == errors.IG_TWO_FACTOR


def test_user_not_found_beats_private_error() -> None:
    assert classify(ig_ex.UserNotFound("nope")) == errors.IG_NOT_FOUND


def test_unknown_client_error_is_network_not_success() -> None:
    assert classify(ig_ex.ClientJSONDecodeError("garbage")) == errors.IG_NETWORK


def test_non_instagrapi_exception_is_internal() -> None:
    assert classify(ValueError("programmer error")) == errors.IG_INTERNAL


def test_wire_shape() -> None:
    body = translate(ig_ex.RateLimitError("slow down")).to_body()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "retryable", "detail"}
    assert body["error"]["code"] == errors.IG_RATE_LIMITED
    assert body["error"]["retryable"] is True
    assert body["error"]["detail"]["exception"] == "RateLimitError"
    assert body["error"]["detail"]["upstream_message"] == "slow down"


def test_retryable_flags_match_the_brief() -> None:
    assert translate(ig_ex.PrivateAccount("x")).retryable is False
    assert translate(ig_ex.BadPassword("x")).retryable is False
    assert translate(ig_ex.ClientConnectionError("x")).retryable is True
    assert translate(ig_ex.VideoNotDownload("x")).retryable is True


def test_translate_passes_igerror_through_and_merges_detail() -> None:
    original = IgError(errors.IG_DRIFT, "drifted", detail={"a": 1})
    out = translate(original, detail={"operation": "medias"})
    assert out is original
    assert out.detail == {"a": 1, "operation": "medias"}


def test_unknown_code_is_rejected() -> None:
    with pytest.raises(ValueError):
        IgError("IG_MADE_UP", "nope")


def test_drift_error_carries_raw_payload() -> None:
    err = errors.DriftError("pk missing", {"code": "abc"}, field="pk")
    assert err.code == errors.IG_DRIFT
    assert err.retryable is False
    assert err.detail["field"] == "pk"
    assert err.detail["raw"] == {"code": "abc"}


def test_expired_session_client_error_is_auth_not_network() -> None:
    # The first real-data run: an expired session came back as ClientError("login_required").
    assert classify(ig_ex.ClientError("login_required")) == errors.IG_AUTH_REQUIRED
    assert classify(ig_ex.ClientUnauthorizedError("401")) == errors.IG_AUTH_REQUIRED
