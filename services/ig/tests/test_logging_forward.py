import logging
from types import SimpleNamespace
from unittest.mock import patch

from crowsnest_ig import logging as clog

# _forward() now sources the ingest URL and token from config.py's validated
# Config (routed through crowsnest_ig.logging.load_config) rather than reading
# os.environ directly, so these tests patch that seam instead of the
# environment. A real IG_SERVICE_TOKEN must also be >=16 chars per config.py's
# own validation, which a plain env monkeypatch would otherwise have to satisfy
# too; patching load_config sidesteps that and keeps the test focused on the
# forwarding behavior rather than config validation (already covered by
# test_config.py).
_FAKE_CONFIG = SimpleNamespace(
    ingest_url="http://test/api/logs/ingest",
    service_token="secret",
)


def test_forward_posts_event(monkeypatch):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append((url, json, headers))

        class R:
            status_code = 204

        return R()

    with patch("crowsnest_ig.logging.load_config", return_value=_FAKE_CONFIG), patch(
        "crowsnest_ig.logging.httpx.post", side_effect=fake_post
    ):
        clog.log_event("session.invalidated", level=logging.ERROR, handle="@kai")

    assert len(calls) == 1
    url, body, headers = calls[0]
    assert url == "http://test/api/logs/ingest"
    assert body["event"] == "session.invalidated"
    assert body["level"] == "error"
    assert body["source"] == "sidecar"
    assert headers["X-IG-Token"] == "secret"


def test_forward_swallows_errors(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("next is down")

    with patch("crowsnest_ig.logging.load_config", return_value=_FAKE_CONFIG), patch(
        "crowsnest_ig.logging.httpx.post", side_effect=boom
    ):
        # must not raise
        clog.log_event("session.recovered", level=logging.INFO)
