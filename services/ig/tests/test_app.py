from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from crowsnest_ig.app import create_app, normalize_handle, parse_since
from crowsnest_ig.config import Config
from crowsnest_ig.errors import IgError

from .conftest import TOKEN

AUTH = {"X-IG-Token": TOKEN}


@pytest.fixture()
def client(config: Config):
    with TestClient(create_app(config)) as test_client:
        yield test_client


# ------------------------------------------------------------------ health --
def test_health_works_when_not_logged_in(client: TestClient) -> None:
    response = client.get("/health", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["logged_in"] is False
    assert body["username"] is None
    assert body["instagrapi_version"] == "2.18.9"
    assert body["session_loaded"] is False
    assert body["can_login"] is False
    assert body["cooldown_until"] is None


# -------------------------------------------------------------------- auth --
def test_missing_token_is_401_in_the_error_shape(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "IG_UNAUTHORIZED"


def test_wrong_token_is_401(client: TestClient) -> None:
    response = client.get("/health", headers={"X-IG-Token": "nope"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("get", "/profile?handle=kallaway", None),
        ("get", "/medias?handle=kallaway", None),
        ("post", "/login", {}),
        ("post", "/challenge/resolve", {"code": "1"}),
        ("post", "/two-factor", {"code": "1"}),
        ("post", "/logout", {}),
        ("post", "/download", {"url": "https://x/y.jpg", "kind": "thumbnail"}),
        ("post", "/resolve-media", {"pk": "1"}),
        ("post", "/media-stats", {"pk": "1"}),
    ],
)
def test_every_endpoint_requires_the_token(
    client: TestClient, method: str, path: str, payload: dict | None
) -> None:
    kwargs = {} if payload is None else {"json": payload}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "IG_UNAUTHORIZED"


# ------------------------------------------------------- data w/o a session --
def test_profile_without_a_session_is_auth_required(client: TestClient) -> None:
    response = client.get("/profile?handle=kallaway", headers=AUTH)
    assert response.status_code == 401
    body = response.json()["error"]
    assert body["code"] == "IG_AUTH_REQUIRED"
    assert body["retryable"] is True


def test_medias_without_a_session_is_auth_required_not_empty(
    client: TestClient,
) -> None:
    """The forbidden failure mode: an error must never become `{"items": []}`."""
    response = client.get("/medias?handle=kallaway", headers=AUTH)
    assert response.status_code == 401
    assert "items" not in response.json()
    assert response.json()["error"]["code"] == "IG_AUTH_REQUIRED"


def test_login_without_credentials_is_typed(client: TestClient) -> None:
    response = client.post("/login", json={}, headers=AUTH)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "IG_AUTH_REQUIRED"


def test_two_factor_requires_a_code(client: TestClient) -> None:
    response = client.post("/two-factor", json={"code": "  "}, headers=AUTH)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IG_BAD_REQUEST"


def test_challenge_resolve_without_a_login_in_progress(client: TestClient) -> None:
    response = client.post("/challenge/resolve", json={"code": "123456"}, headers=AUTH)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IG_BAD_REQUEST"


def test_logout_is_idempotent(client: TestClient) -> None:
    response = client.post("/logout", json={}, headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "session_removed": False}


# ------------------------------------------------------------- validation ---
def test_bad_handle_is_rejected_before_any_network_call(client: TestClient) -> None:
    response = client.get(
        "/medias?handle=https://www.instagram.com/hormozi/", headers=AUTH
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IG_BAD_REQUEST"


def test_bad_since_iso_is_rejected(client: TestClient) -> None:
    response = client.get(
        "/medias?handle=kallaway&since_iso=last-tuesday", headers=AUTH
    )
    assert response.status_code == 400
    assert "ISO-8601" in response.json()["error"]["message"]


def test_validation_errors_use_the_error_envelope(client: TestClient) -> None:
    response = client.get("/medias", headers=AUTH)  # handle is required
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IG_BAD_REQUEST"


def test_unknown_endpoint_uses_the_error_envelope(client: TestClient) -> None:
    response = client.get("/nope", headers=AUTH)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "IG_NOT_FOUND"


def test_download_rejects_a_non_http_url(client: TestClient) -> None:
    response = client.post(
        "/download",
        json={"url": "file:///etc/passwd", "kind": "thumbnail"},
        headers=AUTH,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IG_BAD_REQUEST"


def test_download_rejects_an_unknown_kind(client: TestClient) -> None:
    response = client.post(
        "/download",
        json={"url": "https://x/y.jpg", "kind": "sneaky"},
        headers=AUTH,
    )
    assert response.status_code == 400


# ------------------------------------------------------------ pure helpers --
@pytest.mark.parametrize(
    "raw,expected",
    [("kallaway", "kallaway"), ("@kallaway", "kallaway"), ("  @Kallaway ", "kallaway")],
)
def test_normalize_handle(raw: str, expected: str) -> None:
    assert normalize_handle(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "https://www.instagram.com/hormozi/",
        "@https://www.instagram.com/hormozi/",
        "",
        "@",
        "has spaces",
        "way" * 20,
        "bad!char",
    ],
)
def test_normalize_handle_rejects_junk(raw: str) -> None:
    with pytest.raises(IgError):
        normalize_handle(raw)


def test_parse_since_assumes_utc_when_naive() -> None:
    assert parse_since("2026-07-01T00:00:00").tzinfo is not None
    assert parse_since(None) is None
    assert parse_since("  ") is None


# ---------------------------------------------------------- session status --
def test_health_reports_a_loaded_session(config: Config) -> None:
    config.session_path.parent.mkdir(parents=True, exist_ok=True)
    config.session_path.write_text(
        '{"uuids": {}, "device_settings": {}, "user_agent": "x", "cookies": {},'
        ' "authorization_data": {}, "last_login": null, "country": "US",'
        ' "country_code": 1, "locale": "en_US", "timezone_offset": 0}'
    )
    cfg = replace(config, username="burner", password="secret")
    with TestClient(create_app(cfg)) as client:
        body = client.get("/health", headers=AUTH).json()
    assert body["session_loaded"] is True
    assert body["can_login"] is True
    assert body["logged_in"] is False  # a blob without a user id is not a session
