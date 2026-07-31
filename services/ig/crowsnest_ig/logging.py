"""Structured JSON logging to stdout.

Every line is one JSON object so the Node side (or `jq`) can grep events like
`session.invalidated`, `session.recovered`, `ratelimit.backoff` without parsing
prose. Gate 3 proof #10 reads these lines.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any

import httpx

from .config import load_config

LOGGER_NAME = "crowsnest_ig"

_LEVEL_NAME = {logging.INFO: "info", logging.WARNING: "warn", logging.ERROR: "error"}

# NB: "code" is deliberately absent — it is the error-taxonomy code (IG_*), and
# redacting it would blind the very logs Gate 3 reads. The secret-bearing
# challenge/2FA fields are named explicitly instead.
_SECRET_KEYS = {"password", "ig_password", "token", "service_token",
                "verification_code", "security_code", "challenge_code",
                "two_factor_code", "authorization_data", "cookies", "sessionid"}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("***redacted***" if k.lower() in _SECRET_KEYS else _redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "event", record.msg if isinstance(record.msg, str) else "log"),
            "message": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if fields:
            payload["fields"] = _redact(fields)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_configured = False


def configure() -> logging.Logger:
    global _configured
    logger = logging.getLogger(LOGGER_NAME)
    if not _configured:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
        _configured = True
    return logger


def _forward(event: str, level: int, fields: dict[str, Any]) -> None:
    """POST one event to the Next ingest endpoint. Fire and forget: any failure
    -- including the config being unset or invalid -- is swallowed, because the
    line is already on stdout and logging must never break the caller.

    The ingest URL and service token come from config.py's validated Config,
    the same as every other module in this service, rather than from
    ``os.environ`` directly: config.py is the single place allowed to read the
    environment, and its ``service_token`` field is fail-fast validated
    (length, presence) where a raw ``os.environ.get(..., "")`` is not.
    """
    try:
        cfg = load_config()
        body = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z",
            "level": _LEVEL_NAME.get(level, "info"),
            "source": "sidecar",
            "event": event,
            "fields": _redact(fields),
        }
        httpx.post(
            cfg.ingest_url,
            json=body,
            headers={"X-IG-Token": cfg.service_token},
            timeout=1.0,
        )
    except Exception:
        pass


def log_event(event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Emit one structured event line."""
    logger = configure()
    logger.log(level, event, extra={"event": event, "fields": fields})
    _forward(event, level, fields)
