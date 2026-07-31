import logging
from unittest.mock import patch

from crowsnest_ig import logging as clog


def test_forward_posts_event(monkeypatch):
    monkeypatch.setenv("CROWSNEST_INGEST_URL", "http://test/api/logs/ingest")
    monkeypatch.setenv("IG_SERVICE_TOKEN", "secret")
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append((url, json, headers))

        class R:
            status_code = 204

        return R()

    with patch("crowsnest_ig.logging.httpx.post", side_effect=fake_post):
        clog.log_event("session.invalidated", level=logging.ERROR, handle="@kai")

    assert len(calls) == 1
    url, body, headers = calls[0]
    assert url == "http://test/api/logs/ingest"
    assert body["event"] == "session.invalidated"
    assert body["level"] == "error"
    assert body["source"] == "sidecar"
    assert headers["X-IG-Token"] == "secret"


def test_forward_swallows_errors(monkeypatch):
    monkeypatch.setenv("CROWSNEST_INGEST_URL", "http://test/api/logs/ingest")
    monkeypatch.setenv("IG_SERVICE_TOKEN", "secret")

    def boom(*a, **k):
        raise RuntimeError("next is down")

    with patch("crowsnest_ig.logging.httpx.post", side_effect=boom):
        # must not raise
        clog.log_event("session.recovered", level=logging.INFO)
