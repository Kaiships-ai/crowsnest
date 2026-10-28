"""The one long-lived authenticated instagrapi Client, and its lifecycle.

Responsibilities:
  * build the client with a pinned device + deterministic uuids;
  * load / persist the session blob (mode 0600);
  * drive login, 2FA and the challenge flow across HTTP round-trips;
  * recover exactly once from an invalidated session, logging both the
    invalidation and the recovery;
  * translate rate limits into a persisted cooldown instead of hammering.

Concurrency: instagrapi's Client is not thread-safe, so every call goes through
one re-entrant lock. The challenge broker deliberately lives *outside* that lock
so an in-flight parked login can still be fed a code by another request.
"""

from __future__ import annotations

import json
import os
import stat
import threading
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from instagrapi import Client
from instagrapi import exceptions as ig_ex
from instagrapi.mixins.challenge import ChallengeChoice

from .config import Config
from .device import derive_device, derive_uuids
from .errors import (
    IG_AUTH_REQUIRED,
    IG_BAD_REQUEST,
    IG_CHALLENGE,
    IG_RATE_LIMITED,
    IgError,
    translate,
)
from .logging import log_event
from .ratelimit import Cooldown

T = TypeVar("T")

# How long a parked login thread waits for the operator to supply a challenge
# choice or code. Not an env var: it is a human-input timeout, not a tuning knob.
CHALLENGE_INPUT_TIMEOUT_S = 300.0

# How long an HTTP handler waits for the login thread to reach its next state
# (finished, or parked awaiting input) before answering.
LOGIN_STATE_TIMEOUT_S = 90.0

_RATE_LIMIT_EXCEPTIONS = (
    ig_ex.FeedbackRequired,
    ig_ex.PleaseWaitFewMinutes,
    ig_ex.RateLimitError,
    ig_ex.ClientThrottledError,
    ig_ex.SentryBlock,
)

_LOGIN_REQUIRED_EXCEPTIONS = (ig_ex.LoginRequired, ig_ex.ClientLoginRequired)


class ChallengeBroker:
    """Bridges instagrapi's blocking challenge callbacks to HTTP round-trips."""

    def __init__(self, input_timeout: float = CHALLENGE_INPUT_TIMEOUT_S) -> None:
        self.input_timeout = input_timeout
        self._lock = threading.Lock()
        self._choice_wanted = threading.Event()
        self._choice_given = threading.Event()
        self._code_wanted = threading.Event()
        self._code_given = threading.Event()
        self._choice: str | None = None
        self._code: str | None = None
        self.channels: list[str] = []
        self.channel: str | None = None

    def reset(self) -> None:
        with self._lock:
            for event in (
                self._choice_wanted,
                self._choice_given,
                self._code_wanted,
                self._code_given,
            ):
                event.clear()
            self._choice = None
            self._code = None
            self.channels = []
            self.channel = None

    # -- called from the login worker thread -------------------------------
    def request_choice(self, channels: list[str]) -> str:
        with self._lock:
            self.channels = list(channels)
            self._choice_wanted.set()
        log_event("challenge.choice_required", channels=channels)
        if not self._choice_given.wait(self.input_timeout):
            raise IgError(
                IG_CHALLENGE,
                "Timed out waiting for a challenge delivery choice "
                f"(POST /challenge/resolve {{choice}}) after {self.input_timeout:.0f}s.",
                detail={"stage": "choice", "channels": channels},
            )
        assert self._choice is not None
        return self._choice

    def request_code(self, channel: str) -> str:
        with self._lock:
            self.channel = channel
            self._code_wanted.set()
        log_event("challenge.code_required", channel=channel)
        if not self._code_given.wait(self.input_timeout):
            raise IgError(
                IG_CHALLENGE,
                "Timed out waiting for a challenge code "
                f"(POST /challenge/resolve {{code}}) after {self.input_timeout:.0f}s.",
                detail={"stage": "code", "channel": channel},
            )
        assert self._code is not None
        return self._code

    # -- called from HTTP handlers -----------------------------------------
    def stage(self) -> str | None:
        if self._code_wanted.is_set() and not self._code_given.is_set():
            return "code"
        if self._choice_wanted.is_set() and not self._choice_given.is_set():
            return "choice"
        return None

    def wants_input(self) -> bool:
        return self.stage() is not None

    def supply_choice(self, choice: str) -> None:
        if self.stage() != "choice":
            raise IgError(
                IG_BAD_REQUEST,
                "No challenge is currently waiting for a delivery choice.",
                detail={"stage": self.stage()},
            )
        with self._lock:
            self._choice = choice
            self._choice_given.set()
        log_event("challenge.choice_supplied", choice=choice)

    def supply_code(self, code: str) -> None:
        if self.stage() != "code":
            raise IgError(
                IG_BAD_REQUEST,
                "No challenge is currently waiting for a verification code.",
                detail={"stage": self.stage()},
            )
        with self._lock:
            self._code = code
            self._code_given.set()
        log_event("challenge.code_supplied", channel=self.channel)


class CrowsnestClient(Client):
    """instagrapi Client with the challenge callbacks routed through a broker."""

    def __init__(self, *args: Any, broker: ChallengeBroker, **kwargs: Any) -> None:
        self._broker = broker
        super().__init__(*args, **kwargs)

    def challenge_code_handler(self, username: str, choice: Any) -> str:
        channel = "sms" if choice == ChallengeChoice.SMS else "email"
        return self._broker.request_code(channel)

    def challenge_resolve_simple(self, challenge_url: str) -> bool:
        """Let the operator pick the delivery channel before instagrapi does.

        Stock instagrapi always prefers email when both email and phone are
        offered. We park at that fork and ask. If the operator's answer matches
        what stock instagrapi would do, we delegate untouched (the safe, common
        path). Only when the operator explicitly wants SMS do we send the choice
        ourselves and then hand back to stock handling for the code step.

        NOTE: this branch cannot be exercised without live credentials and an
        account that is actually challenged; it is untested against Instagram.
        """
        step_name = self.last_json.get("step_name", "")
        if step_name not in ("select_verify_method", "select_contact_point_recovery"):
            return super().challenge_resolve_simple(challenge_url)

        step_data = self.last_json.get("step_data") or {}
        available: list[str] = []
        if "email" in step_data:
            available.append("email")
        if "phone_number" in step_data:
            available.append("sms")
        if not available:
            return super().challenge_resolve_simple(challenge_url)

        wanted = self._broker.request_choice(available)
        if wanted not in available:
            raise IgError(
                IG_CHALLENGE,
                f"Instagram did not offer {wanted!r} for this challenge.",
                detail={"available": available, "requested": wanted},
            )

        stock_choice = "email" if "email" in available else "sms"
        if wanted == stock_choice:
            return super().challenge_resolve_simple(challenge_url)

        # Operator asked for SMS while email was on offer: send the choice
        # ourselves, then let stock instagrapi handle the verify_*_code step.
        stripped = challenge_url.lstrip("/")
        self._send_private_request(
            stripped, {"choice": str(ChallengeChoice.SMS.value)}
        )
        return super().challenge_resolve_simple(stripped)


class SessionManager:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.broker = ChallengeBroker()
        self.cooldown = Cooldown(config.cooldown_path)
        self._lock = threading.RLock()
        self._client: CrowsnestClient | None = None
        self._session_loaded = False
        self._login_thread: threading.Thread | None = None
        self._login_done = threading.Event()
        self._login_error: IgError | None = None
        self._login_ok = False
        self._pending_credentials: tuple[str, str] | None = None

    # -- construction ------------------------------------------------------
    @property
    def client(self) -> CrowsnestClient:
        with self._lock:
            if self._client is None:
                self._client = self._build_client()
            return self._client

    def _build_client(self) -> CrowsnestClient:
        client = self._fresh_client()
        self._session_loaded = self._load_session(client)
        return client

    def _fresh_client(self) -> CrowsnestClient:
        """A client with this device, locale and proxy, and no session loaded."""
        client = CrowsnestClient(broker=self.broker)
        # delay_range is the pacing control, and the ONLY one. Deliberately not setting
        # client.request_timeout: despite the name, instagrapi sleeps that many SECONDS
        # before every private request (mixins/private.py:434), so feeding it
        # IG_REQUEST_TIMEOUT_MS (180000ms here) made a single call take 182.9s instead of
        # 1.9s. `call` holds a lock for the whole operation, so five reels took a quarter
        # of an hour. That variable is the TypeScript client's HTTP timeout and means
        # nothing to instagrapi.
        client.delay_range = [1, 3]

        seed = self.config.effective_device_seed() if (
            self.config.device_seed or self.config.username
        ) else None
        if seed:
            client.set_uuids(derive_uuids(seed))
            client.set_device(derive_device(seed))
            log_event(
                "session.device_pinned",
                seed_fingerprint=_fingerprint(seed),
                model=client.device_settings.get("model"),
                android_device_id=client.android_device_id,
            )

        # Align locale/country/timezone with where the traffic actually originates.
        # instagrapi defaults to en_US / US / UTC, so a device claiming to be an
        # American phone shows up on a Vietnamese residential IP — an inconsistency
        # Instagram's login risk checks read as automation. Observed here: a password
        # that works in a browser is answered with BadPassword by the private API.
        client.set_locale(self.config.locale)
        client.set_country(self.config.country)
        client.set_timezone_offset(self.config.timezone_offset_s)
        log_event(
            "session.locale_set",
            locale=self.config.locale,
            country=self.config.country,
            timezone_offset_s=self.config.timezone_offset_s,
        )

        if self.config.proxy:
            client.set_proxy(self.config.proxy)
            log_event("session.proxy_set", proxy=_mask_proxy(self.config.proxy))
        return client

    def _load_session(self, client: CrowsnestClient) -> bool:
        path = self.config.session_path
        if not path.exists():
            log_event("session.absent", path=str(path))
            return False
        try:
            client.load_settings(path)
        except (OSError, json.JSONDecodeError, ValueError, TypeError) as exc:
            # A corrupt session blob must be loud, not silently ignored.
            log_event(
                "session.load_failed",
                path=str(path),
                error=f"{type(exc).__name__}: {exc}",
            )
            return False
        # load_settings replaces settings wholesale; re-apply runtime knobs. Not
        # request_timeout: see _build_client, it is a per-request sleep, not a timeout.
        client.delay_range = [1, 3]
        if self.config.proxy:
            client.set_proxy(self.config.proxy)
        if self.config.username:
            client.username = self.config.username
        if self.config.password:
            client.password = self.config.password
        log_event("session.loaded", path=str(path), user_id=client.user_id)
        return True

    def _persist_session(self) -> None:
        path = self.config.session_path
        path.parent.mkdir(parents=True, exist_ok=True)
        # Create with 0600 *before* anything is written to it.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.close(fd)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        assert self._client is not None
        self._client.dump_settings(path)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        self._session_loaded = True
        log_event("session.persisted", path=str(path), mode="0600")

    # -- status ------------------------------------------------------------
    @property
    def session_loaded(self) -> bool:
        return self._session_loaded

    def logged_in(self) -> bool:
        client = self._client
        return bool(client is not None and client.user_id)

    def username(self) -> str | None:
        client = self._client
        if client is not None and getattr(client, "username", None):
            return str(client.username)
        return self.config.username

    # -- login -------------------------------------------------------------
    def _credentials(
        self, username: str | None, password: str | None
    ) -> tuple[str, str]:
        user = username or self.config.username
        secret = password or self.config.password
        if not user or not secret:
            raise IgError(
                IG_AUTH_REQUIRED,
                "No Instagram credentials available: set IG_USERNAME/IG_PASSWORD "
                "or pass username/password to POST /login.",
            )
        return user, secret

    def start_login(
        self,
        username: str | None = None,
        password: str | None = None,
        verification_code: str | None = None,
    ) -> dict[str, Any]:
        """Start (or resume) a login and report the state it reached."""
        with self._lock:
            if self._login_thread is not None and self._login_thread.is_alive():
                raise IgError(
                    IG_BAD_REQUEST,
                    "A login is already in progress; resolve it via "
                    "/challenge/resolve or /two-factor.",
                    detail={"stage": self.broker.stage()},
                )
            user, secret = self._credentials(username, password)
            self._pending_credentials = (user, secret)
            self._enforce_cooldown()
            self.broker.reset()
            self._login_done.clear()
            self._login_error = None
            self._login_ok = False
            client = self.client
            thread = threading.Thread(
                target=self._login_worker,
                args=(client, user, secret, verification_code or ""),
                name="ig-login",
                daemon=True,
            )
            self._login_thread = thread
            thread.start()

        return self._await_login_state()

    def _login_worker(
        self,
        client: CrowsnestClient,
        username: str,
        password: str,
        verification_code: str,
    ) -> None:
        log_event("login.started", username=username)
        try:
            relogin = bool(client.user_id)
            ok = client.login(
                username,
                password,
                relogin=relogin,
                verification_code=verification_code,
            )
            if not ok:
                self._login_error = IgError(
                    IG_AUTH_REQUIRED,
                    "Instagram returned an unsuccessful login without an error.",
                )
                log_event("login.failed", username=username, reason="login_returned_false")
            else:
                self._login_ok = True
                with self._lock:
                    self._persist_session()
                log_event("login.succeeded", username=username, user_id=client.user_id)
        except BaseException as exc:  # noqa: BLE001 - re-raised to the caller as typed
            error = translate(exc, detail={"phase": "login"})
            self._login_error = error
            log_event(
                "login.failed",
                username=username,
                code=error.code,
                error=error.message,
                exception=type(exc).__name__,
            )
        finally:
            self._login_done.set()

    def _await_login_state(self, timeout: float = LOGIN_STATE_TIMEOUT_S) -> dict[str, Any]:
        """Wait until the login thread finishes or parks awaiting operator input."""
        deadline = _monotonic() + timeout
        while True:
            if self._login_done.is_set():
                if self._login_error is not None:
                    raise self._login_error
                if self._login_ok:
                    return {"status": "ok", "username": self.username()}
                raise IgError(IG_AUTH_REQUIRED, "Login did not complete.")
            stage = self.broker.stage()
            if stage is not None:
                return {
                    "status": "challenge_required",
                    "stage": stage,
                    "channels": self.broker.channels if stage == "choice" else None,
                    "username": self.username(),
                    "message": (
                        "Instagram wants a delivery channel: POST /challenge/resolve {choice}"
                        if stage == "choice"
                        else "Instagram wants a verification code: POST /challenge/resolve {code}"
                    ),
                }
            if _monotonic() > deadline:
                raise IgError(
                    IG_AUTH_REQUIRED,
                    f"Login did not reach a decision within {timeout:.0f}s.",
                    detail={"phase": "login"},
                )
            self._login_done.wait(0.1)

    def resolve_challenge(
        self, choice: str | None = None, code: str | None = None
    ) -> dict[str, Any]:
        if choice is None and code is None:
            raise IgError(
                IG_BAD_REQUEST,
                "POST /challenge/resolve needs either {choice} or {code}.",
            )
        if self._login_thread is None or not self._login_thread.is_alive():
            raise IgError(
                IG_BAD_REQUEST,
                "No challenge is in progress. Call POST /login first.",
            )
        if choice is not None:
            self.broker.supply_choice(choice)
        if code is not None:
            self.broker.supply_code(code)
        return self._await_login_state()

    def complete_two_factor(self, code: str) -> dict[str, Any]:
        """Finish a login that stopped at TwoFactorRequired.

        instagrapi re-runs accounts/login/ and submits the code against the
        two-factor identifier from that fresh response, so the same client must
        be reused - which is exactly what this sidecar exists to provide.
        """
        if not code.strip():
            raise IgError(IG_BAD_REQUEST, "A two-factor code is required.")
        with self._lock:
            if self._login_thread is not None and self._login_thread.is_alive():
                raise IgError(
                    IG_BAD_REQUEST,
                    "A login is already in progress; it is waiting on "
                    "/challenge/resolve, not /two-factor.",
                    detail={"stage": self.broker.stage()},
                )
            if self._pending_credentials is None:
                username, password = self._credentials(None, None)
            else:
                username, password = self._pending_credentials
        log_event("login.two_factor_submitted", username=username)
        return self.start_login(username, password, verification_code=code.strip())

    def login_by_sessionid(self, sessionid: str) -> dict[str, Any]:
        """Adopt an existing web session instead of authenticating with a password.

        Why this exists: Instagram will happily accept a password in a browser and
        still answer ``BadPassword`` to the private API when it distrusts the IP or
        device — its own error text says so. Observed here across two accounts whose
        credentials were verified working on instagram.com.

        Importing the ``sessionid`` cookie from a browser that is already signed in
        sidesteps the login endpoint entirely. It performs no password
        authentication, so it cannot add to the failed-login count that gets accounts
        checkpointed — which makes it strictly safer than retrying a login that keeps
        being refused.

        The cookie is exchanged for a full instagrapi session and persisted like any
        other, so subsequent runs reuse it normally.
        """
        sessionid = sessionid.strip().strip('"').strip("'")
        if not sessionid:
            raise IgError(IG_BAD_REQUEST, "A sessionid is required.")

        with self._lock:
            self._enforce_cooldown()
            client = self.client
            log_event("session.import.started", source="sessionid")
            try:
                ok = client.login_by_sessionid(sessionid)
            except Exception as exc:  # noqa: BLE001 - translated below
                err = self._handle(exc, "login_by_sessionid")
                log_event(
                    "session.import.failed",
                    code=err.code,
                    error=str(err),
                    exception=type(exc).__name__,
                )
                raise err from exc

            if not ok or not client.user_id:
                log_event("session.import.rejected", reason="instagram did not accept the sessionid")
                raise IgError(
                    IG_AUTH_REQUIRED,
                    "Instagram rejected that sessionid. Copy a fresh one from a "
                    "browser tab that is currently signed in.",
                )

            self._login_ok = True
            self._login_error = None
            self._persist_session()
            username = getattr(client, "username", None) or self.config.username
            log_event("session.import.succeeded", user_id=client.user_id, username=username)
            return {"status": "ok", "username": username, "user_id": str(client.user_id)}

    def sample_sessionid(self, sessionid: str) -> dict[str, Any]:
        """Try a sessionid on a throwaway client and return its own profile.

        Test connection in the app's session form: nothing is adopted or persisted, so
        the session the sidecar already holds keeps working whatever the test says.
        """
        sessionid = sessionid.strip().strip('"').strip("'")
        if not sessionid:
            raise IgError(IG_BAD_REQUEST, "A sessionid is required.")
        with self._lock:
            self._enforce_cooldown()
            client = self._fresh_client()
            try:
                ok = client.login_by_sessionid(sessionid)
                if not ok or not client.user_id:
                    raise IgError(IG_AUTH_REQUIRED, "Instagram rejected that sessionid.")
                user = client.user_info_by_username(client.username, use_cache=False)
            except IgError:
                raise
            except Exception as exc:  # noqa: BLE001 - translated below
                raise self._handle(exc, "sample_sessionid") from exc
            log_event("session.sample.succeeded", user_id=client.user_id)
            return user.model_dump(mode="json")

    def logout(self) -> dict[str, Any]:
        with self._lock:
            removed = False
            try:
                self.config.session_path.unlink()
                removed = True
            except FileNotFoundError:
                pass
            self._client = None
            self._session_loaded = False
            self._login_ok = False
            self._login_error = None
            self._pending_credentials = None
            self.broker.reset()
            self.cooldown.clear()
        log_event("session.logged_out", session_removed=removed)
        return {"status": "ok", "session_removed": removed}

    # -- the call wrapper --------------------------------------------------
    def _enforce_cooldown(self) -> None:
        remaining = self.cooldown.remaining()
        if remaining <= 0:
            return
        state = self.cooldown.state()
        raise IgError(
            IG_RATE_LIMITED,
            f"Instagram cooldown active for another {remaining:.0f}s.",
            detail={
                "retry_after_sec": round(remaining, 3),
                "attempt": state["attempt"],
                "reason": state["reason"],
                "cooldown_until": state["until"].isoformat().replace("+00:00", "Z")
                if state["until"]
                else None,
            },
        )

    def require_login(self) -> None:
        if not self.logged_in():
            raise IgError(
                IG_AUTH_REQUIRED,
                "Not logged in to Instagram. POST /login first "
                "(anonymous access to Instagram does not work).",
            )

    def call(self, operation: str, fn: Callable[[CrowsnestClient], T]) -> T:
        """Run one authenticated operation with recovery + rate-limit policy."""
        with self._lock:
            self._enforce_cooldown()
            self.require_login()
            client = self.client
            try:
                return fn(client)
            except _LOGIN_REQUIRED_EXCEPTIONS as exc:
                log_event(
                    "session.invalidated",
                    operation=operation,
                    exception=type(exc).__name__,
                    error=str(exc),
                )
                self._recover_session()
                log_event("session.recovered", operation=operation)
                try:
                    result = fn(client)
                except BaseException as retry_exc:  # noqa: BLE001
                    if isinstance(retry_exc, _LOGIN_REQUIRED_EXCEPTIONS):
                        log_event(
                            "session.recovery_failed",
                            operation=operation,
                            exception=type(retry_exc).__name__,
                        )
                        raise IgError(
                            IG_AUTH_REQUIRED,
                            "Instagram session expired and one re-login did not "
                            "restore it — re-authenticate.",
                            detail={"operation": operation},
                        ) from retry_exc
                    raise self._handle(retry_exc, operation) from retry_exc
                log_event("session.retry_succeeded", operation=operation)
                return result
            except BaseException as exc:  # noqa: BLE001
                raise self._handle(exc, operation) from exc

    def _handle(self, exc: BaseException, operation: str) -> IgError:
        if isinstance(exc, _RATE_LIMIT_EXCEPTIONS):
            decision = self.cooldown.record_backoff(reason=type(exc).__name__)
            return IgError(
                IG_RATE_LIMITED,
                "Instagram is throttling this account — "
                f"retry in {decision['retry_after_sec']:.0f}s.",
                detail={"operation": operation, **decision},
            )
        return translate(exc, detail={"operation": operation})

    def _recover_session(self) -> None:
        """One re-login using stored settings. Raises IgError on failure."""
        client = self.client
        if self.config.session_path.exists():
            try:
                client.load_settings(self.config.session_path)
                # Not request_timeout: see _build_client, it is a per-request sleep.
                client.delay_range = [1, 3]
                if self.config.proxy:
                    client.set_proxy(self.config.proxy)
            except (OSError, json.JSONDecodeError, ValueError, TypeError) as exc:
                log_event(
                    "session.recovery_settings_unreadable",
                    path=str(self.config.session_path),
                    error=f"{type(exc).__name__}: {exc}",
                )
        username, password = self._credentials(None, None)
        client.relogin_attempt = 0
        try:
            ok = client.login(username, password, relogin=True)
        except BaseException as exc:  # noqa: BLE001
            log_event(
                "session.recovery_failed",
                exception=type(exc).__name__,
                error=str(exc),
            )
            raise translate(exc, detail={"phase": "session_recovery"}) from exc
        if not ok:
            log_event("session.recovery_failed", reason="login_returned_false")
            raise IgError(
                IG_AUTH_REQUIRED,
                "Re-login with stored settings did not succeed.",
            )
        self._persist_session()

    # -- health ------------------------------------------------------------
    def cooldown_until_iso(self) -> str | None:
        deadline = self.cooldown.until()
        if deadline is None or deadline <= datetime.now(timezone.utc):
            return None
        return deadline.isoformat().replace("+00:00", "Z")


def _fingerprint(seed: str) -> str:
    import hashlib

    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def _mask_proxy(dsn: str) -> str:
    if "@" not in dsn:
        return dsn
    scheme, _, rest = dsn.partition("://")
    _, _, host = rest.partition("@")
    return f"{scheme}://***:***@{host}" if scheme else f"***@{host}"


def _monotonic() -> float:
    import time

    return time.monotonic()
