"""Environment configuration, validated once at import.

The process REFUSES to start when a required variable is missing or malformed.
Nothing outside this module may read ``os.environ`` for configuration.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# services/ig/crowsnest_ig/config.py -> services/ig -> services -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[3]


class ConfigError(RuntimeError):
    """Raised at import time when the environment is unusable.

    This is deliberately fatal: booting with a half-configured environment
    would make the sidecar answer requests it cannot honour.
    """


def load_env_file(path: Path | None = None) -> int:
    """Load ``.env.local`` into ``os.environ`` without shell interpretation.

    Next.js reads ``.env.local`` automatically; this is a separate Python process
    and does not, so without this the documented setup ("put IG_USERNAME /
    IG_PASSWORD in .env.local, then run npm run ig:service") fails at boot.

    Parsed here in Python rather than by ``. ./.env.local`` in a shell wrapper,
    because sourcing executes the file: a password containing a quote aborts the
    shell with "unexpected EOF while looking for matching quote", and one
    containing ``$`` or a backtick would be silently mangled or executed. Real
    passwords contain exactly those characters.

    Variables already present in the environment win, so explicit overrides
    (``IG_PROXY=... npm run ig:service``) still work.

    Returns the number of variables actually applied.
    """
    target = path or (REPO_ROOT / ".env.local")
    if not target.is_file():
        return 0

    applied = 0
    for raw_line in target.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        if not key:
            continue
        value = value.strip()
        # Strip ONE matching pair of surrounding quotes; anything inside is literal.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key in os.environ and os.environ[key].strip():
            continue  # an explicit environment value outranks the file
        os.environ[key] = value
        applied += 1
    return applied


def _require(name: str) -> str:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        raise ConfigError(
            f"{name} is required but missing/empty. "
            f"The Instagram sidecar refuses to start without it."
        )
    return raw.strip()


def _optional(name: str) -> str | None:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return None
    return raw.strip()


def _int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = _optional(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}, got {value}")
    return value


def _path(name: str, default: str) -> Path:
    raw = _optional(name)
    candidate = Path(raw) if raw else Path(default)
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    return candidate.resolve()


@dataclass(frozen=True)
class Config:
    service_token: str
    username: str | None
    password: str | None
    session_path: Path
    media_root: Path
    locale: str
    country: str
    timezone_offset_s: int
    proxy: str | None
    device_seed: str | None
    host: str
    port: int
    request_timeout_ms: int
    download_timeout_ms: int

    @property
    def request_timeout_s(self) -> float:
        return self.request_timeout_ms / 1000.0

    @property
    def download_timeout_s(self) -> float:
        return self.download_timeout_ms / 1000.0

    @property
    def cooldown_path(self) -> Path:
        """Sibling of the session blob; survives restarts (see brief §7)."""
        return self.session_path.with_name(self.session_path.name + ".cooldown")

    @property
    def can_login(self) -> bool:
        return bool(self.username and self.password)

    def effective_device_seed(self) -> str:
        """Stable seed for device/uuid pinning.

        Explicit ``IG_DEVICE_SEED`` wins; otherwise the username is used so the
        same account always presents the same device across restarts.
        """
        if self.device_seed:
            return self.device_seed
        if self.username:
            return f"crowsnest:{self.username.lower()}"
        raise ConfigError(
            "Cannot derive a device seed: set IG_DEVICE_SEED or IG_USERNAME."
        )


def load_config(env: dict[str, str] | None = None) -> Config:
    """Build a Config from the environment. Raises ConfigError when unusable."""
    if env is not None:
        # Test seam: swap the environment without mutating os.environ globally.
        previous = dict(os.environ)
        os.environ.clear()
        os.environ.update(env)
        try:
            return _build()
        finally:
            os.environ.clear()
            os.environ.update(previous)
    # Real startup: pick up .env.local so the sidecar and the Next.js app read the
    # same configuration. Explicitly-set variables still win (see load_env_file).
    load_env_file()
    return _build()


def _build() -> Config:
    token = _require("IG_SERVICE_TOKEN")
    if len(token) < 16:
        raise ConfigError(
            "IG_SERVICE_TOKEN must be at least 16 characters; it is the only "
            "thing standing between a local process and your Instagram session."
        )

    username = _optional("IG_USERNAME")
    password = _optional("IG_PASSWORD")
    if bool(username) != bool(password):
        raise ConfigError(
            "IG_USERNAME and IG_PASSWORD must be set together (or both omitted, "
            "in which case the service boots but cannot log in)."
        )

    host = _optional("IG_SERVICE_HOST") or "127.0.0.1"
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ConfigError(
            f"IG_SERVICE_HOST={host!r} refused: this service holds an "
            "authenticated Instagram session and must bind loopback only."
        )

    return Config(
        service_token=token,
        username=username,
        password=password,
        session_path=_path("IG_SESSION_PATH", "data/ig-session.json"),
        media_root=_path("MEDIA_ROOT", "data/media"),
        # Defaults match instagrapi's own (en_US / US / UTC). Override them to match
        # the network the traffic leaves from: a US-looking device on a foreign
        # residential IP is one of the cheaper automation signals to trip.
        locale=_optional("IG_LOCALE") or "en_US",
        country=_optional("IG_COUNTRY") or "US",
        timezone_offset_s=_int("IG_TZ_OFFSET_SECONDS", 0, minimum=-50400),
        proxy=_optional("IG_PROXY"),
        device_seed=_optional("IG_DEVICE_SEED"),
        host=host,
        port=_int("IG_SERVICE_PORT", 8765),
        request_timeout_ms=_int("IG_REQUEST_TIMEOUT_MS", 30_000),
        download_timeout_ms=_int("IG_DOWNLOAD_TIMEOUT_MS", 120_000),
    )
