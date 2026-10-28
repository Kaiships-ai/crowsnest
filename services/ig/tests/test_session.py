"""Session recovery, rate-limit policy and challenge brokering — offline.

No network: a stub stands in for instagrapi's Client so the *policy* around it
(recover once, log both halves, escalate a cooldown instead of hammering) can
be proven without an Instagram account.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import replace
from types import SimpleNamespace
from typing import Any

import pytest
from instagrapi import exceptions as ig_ex

from crowsnest_ig.config import Config
from crowsnest_ig.errors import IgError
from crowsnest_ig.logging import LOGGER_NAME, configure
from crowsnest_ig.session import ChallengeBroker, CrowsnestClient, SessionManager


class EventCapture(logging.Handler):
    """Captures the structured events the service emits."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, dict[str, Any]]] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.events.append(
            (getattr(record, "event", record.getMessage()), getattr(record, "fields", {}))
        )

    def names(self) -> list[str]:
        return [name for name, _ in self.events]


@pytest.fixture()
def events():
    logger = configure()
    handler = EventCapture()
    logger.addHandler(handler)
    yield handler
    logger.removeHandler(handler)


class FakeClient:
    """Minimal stand-in for instagrapi.Client."""

    def __init__(self) -> None:
        self.user_id = "42"
        self.username = "burner"
        self.password = "secret"
        self.delay_range: list[int] | None = None
        self.request_timeout = 1
        self.relogin_attempt = 0
        self.logins = 0
        self.dumped: list[str] = []
        self.login_raises: BaseException | None = None
        self.login_returns = True
        self.sessionids: list[str] = []
        self.sessionid_raises: BaseException | None = None
        self.sessionid_returns = True

    def login(self, username=None, password=None, relogin=False, verification_code="") -> bool:
        self.logins += 1
        if self.login_raises is not None:
            raise self.login_raises
        self.user_id = "42"
        return self.login_returns

    def login_by_sessionid(self, sessionid: str) -> bool:
        self.sessionids.append(sessionid)
        if self.sessionid_raises is not None:
            raise self.sessionid_raises
        if not self.sessionid_returns:
            self.user_id = None
        else:
            self.user_id = "42"
        return self.sessionid_returns

    def load_settings(self, path, override_app_version: bool = False):
        return json.loads(open(path).read())

    def dump_settings(self, path) -> bool:
        self.dumped.append(str(path))
        open(path, "w").write(json.dumps({"uuids": {}, "device_settings": {}}))
        return True

    def set_proxy(self, dsn):  # pragma: no cover - only when IG_PROXY is set
        self.proxy = dsn


def make_manager(config: Config, client: FakeClient | None = None) -> SessionManager:
    cfg = replace(config, username="burner", password="secret")
    manager = SessionManager(cfg)
    manager._client = client or FakeClient()  # noqa: SLF001 - test seam
    return manager


# ------------------------------------------------------------------ basics --
def test_call_requires_login(config: Config) -> None:
    client = FakeClient()
    client.user_id = None
    manager = make_manager(config, client)
    with pytest.raises(IgError) as excinfo:
        manager.call("op", lambda c: "never")
    assert excinfo.value.code == "IG_AUTH_REQUIRED"


def test_successful_call_passes_through(config: Config) -> None:
    manager = make_manager(config)
    assert manager.call("op", lambda c: {"ok": True}) == {"ok": True}


# -------------------------------------------------------------- recovery ----
def test_login_required_triggers_exactly_one_recovery_and_logs_both(
    config: Config, events: EventCapture
) -> None:
    manager = make_manager(config)
    calls: list[int] = []

    def flaky(client):
        calls.append(1)
        if len(calls) == 1:
            raise ig_ex.LoginRequired("session invalidated by Instagram")
        return "recovered result"

    assert manager.call("user_medias", flaky) == "recovered result"
    assert len(calls) == 2
    assert manager._client.logins == 1  # noqa: SLF001

    names = events.names()
    assert "session.invalidated" in names
    assert "session.recovered" in names
    assert "session.retry_succeeded" in names
    assert names.index("session.invalidated") < names.index("session.recovered")

    invalidation = dict(events.events)["session.invalidated"]
    assert invalidation["operation"] == "user_medias"
    assert invalidation["exception"] == "LoginRequired"


def test_client_login_required_also_recovers(config: Config) -> None:
    manager = make_manager(config)
    calls: list[int] = []

    def flaky(client):
        calls.append(1)
        if len(calls) == 1:
            raise ig_ex.ClientLoginRequired("relogin needed")
        return "ok"

    assert manager.call("profile", flaky) == "ok"


def test_second_failure_escalates_to_auth_required(
    config: Config, events: EventCapture
) -> None:
    manager = make_manager(config)

    def always_dead(client):
        raise ig_ex.LoginRequired("still dead")

    with pytest.raises(IgError) as excinfo:
        manager.call("user_medias", always_dead)
    assert excinfo.value.code == "IG_AUTH_REQUIRED"
    assert "one re-login did not restore it" in excinfo.value.message
    assert "session.recovery_failed" in events.names()


def test_recovery_only_happens_once_per_call(config: Config) -> None:
    manager = make_manager(config)
    attempts: list[int] = []

    def always_dead(client):
        attempts.append(1)
        raise ig_ex.LoginRequired("dead")

    with pytest.raises(IgError):
        manager.call("op", always_dead)
    assert len(attempts) == 2  # original + one retry, never a storm
    assert manager._client.logins == 1  # noqa: SLF001


def test_failed_relogin_surfaces_the_real_cause(config: Config) -> None:
    client = FakeClient()
    client.login_raises = ig_ex.BadPassword("password changed")
    manager = make_manager(config, client)

    with pytest.raises(IgError) as excinfo:
        manager.call("op", lambda c: (_ for _ in ()).throw(ig_ex.LoginRequired("x")))
    assert excinfo.value.code == "IG_BAD_CREDENTIALS"


def test_corrupt_session_file_is_reported_not_swallowed(
    config: Config, events: EventCapture
) -> None:
    """Gate 3 proof #10: corrupting the session blob must be visible."""
    config.session_path.parent.mkdir(parents=True, exist_ok=True)
    config.session_path.write_text("{ this is not json")

    manager = make_manager(config)
    calls: list[int] = []

    def flaky(client):
        calls.append(1)
        if len(calls) == 1:
            raise ig_ex.LoginRequired("session killed by a corrupt settings blob")
        return "back online"

    assert manager.call("op", flaky) == "back online"

    names = events.names()
    assert "session.recovery_settings_unreadable" in names
    assert "session.recovered" in names
    # The corrupt blob is replaced by a freshly dumped one, mode 0600.
    assert "session.persisted" in names
    assert oct(config.session_path.stat().st_mode & 0o777) == "0o600"


# ------------------------------------------------------------ rate limits ---
@pytest.mark.parametrize(
    "exc",
    [
        ig_ex.FeedbackRequired("feedback_required"),
        ig_ex.PleaseWaitFewMinutes("wait"),
        ig_ex.RateLimitError("429"),
        ig_ex.ClientThrottledError("throttled"),
    ],
    ids=lambda e: type(e).__name__,
)
def test_rate_limit_records_a_backoff_and_never_hammers(
    config: Config, events: EventCapture, exc: BaseException
) -> None:
    manager = make_manager(config)

    with pytest.raises(IgError) as excinfo:
        manager.call("user_medias", lambda c: (_ for _ in ()).throw(exc))

    error = excinfo.value
    assert error.code == "IG_RATE_LIMITED"
    assert error.retryable is True
    assert error.detail["attempt"] == 1
    assert error.detail["max_attempts"] == 5
    assert error.detail["retry_after_sec"] >= 0
    assert "ratelimit.backoff" in events.names()


def test_cooldown_blocks_the_next_call_without_touching_instagram(
    config: Config,
) -> None:
    manager = make_manager(config)
    with pytest.raises(IgError):
        manager.call("op", lambda c: (_ for _ in ()).throw(ig_ex.FeedbackRequired("f")))

    touched: list[int] = []
    with pytest.raises(IgError) as excinfo:
        manager.call("op", lambda c: touched.append(1))

    assert touched == []  # the second call never reaches Instagram
    assert excinfo.value.code == "IG_RATE_LIMITED"
    assert excinfo.value.detail["retry_after_sec"] > 0


def test_cooldown_is_reported_by_health_state(config: Config) -> None:
    manager = make_manager(config)
    assert manager.cooldown_until_iso() is None
    with pytest.raises(IgError):
        manager.call("op", lambda c: (_ for _ in ()).throw(ig_ex.RateLimitError("x")))
    assert manager.cooldown_until_iso() is not None


# -------------------------------------------------------------- challenge ---
def test_broker_parks_then_releases_on_a_supplied_code() -> None:
    broker = ChallengeBroker(input_timeout=5.0)
    received: list[str] = []

    def worker() -> None:
        received.append(broker.request_code("email"))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    for _ in range(200):
        if broker.stage() == "code":
            break
        threading.Event().wait(0.01)
    assert broker.stage() == "code"

    broker.supply_code("123456")
    thread.join(timeout=5)
    assert received == ["123456"]
    assert broker.stage() is None


def test_broker_choice_stage_precedes_code_stage() -> None:
    broker = ChallengeBroker(input_timeout=5.0)
    seen: list[str] = []

    def worker() -> None:
        seen.append(broker.request_choice(["email", "sms"]))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    for _ in range(200):
        if broker.stage() == "choice":
            break
        threading.Event().wait(0.01)
    assert broker.channels == ["email", "sms"]
    broker.supply_choice("sms")
    thread.join(timeout=5)
    assert seen == ["sms"]


def test_supplying_a_code_when_nothing_is_waiting_is_a_typed_error() -> None:
    broker = ChallengeBroker(input_timeout=1.0)
    with pytest.raises(IgError) as excinfo:
        broker.supply_code("123456")
    assert excinfo.value.code == "IG_BAD_REQUEST"


def test_broker_times_out_into_a_challenge_error() -> None:
    broker = ChallengeBroker(input_timeout=0.05)
    with pytest.raises(IgError) as excinfo:
        broker.request_code("email")
    assert excinfo.value.code == "IG_CHALLENGE"
    assert excinfo.value.detail["stage"] == "code"


def test_resolve_without_a_login_in_progress_is_rejected(config: Config) -> None:
    manager = make_manager(config)
    with pytest.raises(IgError) as excinfo:
        manager.resolve_challenge(code="123456")
    assert excinfo.value.code == "IG_BAD_REQUEST"


def test_resolve_needs_a_choice_or_a_code(config: Config) -> None:
    manager = make_manager(config)
    with pytest.raises(IgError, match="needs either"):
        manager.resolve_challenge()


# ------------------------------------------------------------------ logout --
def test_logout_removes_the_session_and_the_cooldown(config: Config) -> None:
    manager = make_manager(config)
    config.session_path.parent.mkdir(parents=True, exist_ok=True)
    config.session_path.write_text("{}")
    with pytest.raises(IgError):
        manager.call("op", lambda c: (_ for _ in ()).throw(ig_ex.RateLimitError("x")))
    assert config.cooldown_path.exists()

    result = manager.logout()
    assert result == {"status": "ok", "session_removed": True}
    assert not config.session_path.exists()
    assert not config.cooldown_path.exists()


def test_secrets_are_redacted_from_structured_logs(events: EventCapture) -> None:
    from crowsnest_ig.logging import JsonFormatter, log_event

    log_event("test.secret", password="hunter2", username="burner")
    record = logging.LogRecord(
        LOGGER_NAME, logging.INFO, __file__, 1, "test.secret", None, None
    )
    record.event = "test.secret"
    record.fields = {
        "password": "hunter2",
        "verification_code": "123456",
        "username": "burner",
        "code": "IG_RATE_LIMITED",
    }
    payload = json.loads(JsonFormatter().format(record))
    assert payload["fields"]["password"] == "***redacted***"
    assert payload["fields"]["verification_code"] == "***redacted***"
    assert payload["fields"]["username"] == "burner"
    # The taxonomy code must stay readable; it is the whole point of the logs.
    assert payload["fields"]["code"] == "IG_RATE_LIMITED"


# ------------------------------------------------------- sessionid import --
# Instagram can accept a password in a browser and still answer BadPassword to
# the private API when it distrusts the IP/device. Importing a browser session
# is the escape hatch, and it must NOT perform a password login.


def test_sessionid_import_logs_in_and_persists(config: Config) -> None:
    client = FakeClient()
    client.user_id = None  # not logged in yet
    manager = make_manager(config, client)

    result = manager.login_by_sessionid("  sess-abc-123  ")

    assert result["status"] == "ok"
    assert client.sessionids == ["sess-abc-123"]  # trimmed
    assert client.logins == 0  # crucially: no password authentication happened
    assert client.dumped, "the imported session must be persisted like any other"


def test_sessionid_import_strips_surrounding_quotes(config: Config) -> None:
    client = FakeClient()
    manager = make_manager(config, client)
    manager.login_by_sessionid('"sess-quoted"')
    assert client.sessionids == ["sess-quoted"]


def test_empty_sessionid_is_rejected(config: Config) -> None:
    client = FakeClient()
    manager = make_manager(config, client)
    with pytest.raises(IgError):
        manager.login_by_sessionid("   ")
    assert client.sessionids == []


def test_rejected_sessionid_does_not_claim_success(config: Config) -> None:
    client = FakeClient()
    client.sessionid_returns = False
    manager = make_manager(config, client)

    with pytest.raises(IgError) as excinfo:
        manager.login_by_sessionid("stale-cookie")

    assert "sessionid" in str(excinfo.value).lower()
    assert not client.dumped, "a rejected sessionid must not be persisted"


def test_sample_sessionid_leaves_the_held_session_alone(config: Config) -> None:
    held = FakeClient()
    manager = make_manager(config, held)
    trial = FakeClient()
    trial.user_info_by_username = lambda name, use_cache: SimpleNamespace(model_dump=lambda mode: {"pk": "42", "username": name})
    manager._fresh_client = lambda: trial  # noqa: SLF001 - test seam

    assert manager.sample_sessionid(" sess-new ") == {"pk": "42", "username": "burner"}
    assert trial.sessionids == ["sess-new"]
    assert manager._client is held  # noqa: SLF001
    assert held.sessionids == [] and not held.dumped and not trial.dumped


SESSION_BLOB = (
    '{"uuids": {}, "device_settings": {}, "user_agent": "x", "cookies": {"sessionid": "held"},'
    ' "authorization_data": {"ds_user_id": "7", "sessionid": "held"}, "last_login": null,'
    ' "country": "US", "country_code": 1, "locale": "en_US", "timezone_offset": 0}'
)
TRIAL_ID = "4242424242%3AabcdefghijklmnopqrstuvwxyzABCD%3A1"


def held_session(config: Config) -> SessionManager:
    """A manager that built its client from a saved session file, the way the sidecar boots."""
    config.session_path.parent.mkdir(parents=True, exist_ok=True)
    config.session_path.write_text(SESSION_BLOB)
    manager = SessionManager(replace(config, username="burner", password="secret"))
    assert manager.client.user_id == 7 and manager.session_loaded
    return manager


def test_sample_sessionid_on_a_real_fresh_client_leaves_the_session_and_its_file_alone(
    config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = held_session(config)
    held = manager.client
    held_settings = json.dumps(held.get_settings(), sort_keys=True, default=str)
    looked_up: list[int] = []

    def user_info_v1(self, user_id: int):
        looked_up.append(user_id)
        return SimpleNamespace(username="trial_user", pk=user_id)

    def user_info_by_username(self, username: str, use_cache: bool = True):
        return SimpleNamespace(model_dump=lambda mode: {"pk": str(self.user_id), "username": username})

    monkeypatch.setattr(CrowsnestClient, "user_info_v1", user_info_v1)
    monkeypatch.setattr(CrowsnestClient, "user_info_by_username", user_info_by_username)

    assert manager.sample_sessionid(f" {TRIAL_ID} ") == {"pk": "4242424242", "username": "trial_user"}
    assert looked_up == [4242424242]
    assert manager._client is held  # noqa: SLF001
    assert manager.session_loaded is True
    assert held.user_id == 7
    assert json.dumps(held.get_settings(), sort_keys=True, default=str) == held_settings
    assert config.session_path.read_text() == SESSION_BLOB


def test_sample_sessionid_rejected_by_instagram_is_auth_required_and_changes_nothing(
    config: Config, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = held_session(config)
    held = manager.client

    def refused(self, *args, **kwargs):
        raise ig_ex.LoginRequired("login_required")

    for name in ("user_info_v1", "_user_short_from_private_stream", "user_short_gql"):
        monkeypatch.setattr(CrowsnestClient, name, refused)

    with pytest.raises(IgError) as excinfo:
        manager.sample_sessionid(TRIAL_ID)

    assert excinfo.value.code == "IG_AUTH_REQUIRED"
    assert manager._client is held and held.user_id == 7  # noqa: SLF001
    assert manager.session_loaded is True
    assert config.session_path.read_text() == SESSION_BLOB


def test_sessionid_import_emits_start_and_outcome_events(config: Config, events) -> None:
    manager = make_manager(config, FakeClient())
    manager.login_by_sessionid("sess-xyz")
    names = events.names()
    assert "session.import.started" in names
    assert "session.import.succeeded" in names


def test_client_does_not_inherit_the_http_timeout_as_a_sleep(config: Config) -> None:
    """instagrapi's ``request_timeout`` is a SLEEP, not an HTTP timeout.

    ``mixins/private.py:434`` runs ``time.sleep(self.request_timeout)`` before every
    non-login private request, and the library default is 1. Assigning
    ``IG_REQUEST_TIMEOUT_MS`` to it made every Instagram call sleep 180 seconds: measured
    182.9s per call against 1.9s with the default. ``session.call`` holds a lock across the
    whole operation, so a five reel enrichment pass took about a quarter of an hour.

    ``IG_REQUEST_TIMEOUT_MS`` is the TypeScript client's HTTP timeout and means nothing
    here. Pacing is ``delay_range``, asserted below so removing the bug does not silently
    remove the throttle with it.
    """
    cfg = replace(config, request_timeout_ms=180_000)
    client = SessionManager(cfg)._build_client()  # noqa: SLF001 - test seam

    assert cfg.request_timeout_ms == 180_000, "still parsed, for the HTTP client"
    assert client.request_timeout <= 5, (
        "request_timeout is a per-request sleep; a large value stalls every call"
    )
    assert client.delay_range == [1, 3], "pacing must survive"
