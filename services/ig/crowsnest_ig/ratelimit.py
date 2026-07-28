"""Rate-limit backoff and the restart-surviving cooldown (brief §7).

Exponential backoff with FULL jitter: base 60s, cap 30min, max 5 attempts.

Judgement call, stated plainly: the backoff is **not** slept inside the HTTP
request. Node calls this sidecar with a 30s AbortSignal, so sleeping 60s-30min
in-request would guarantee a client-side timeout and hide the real cause. The
backoff decision is instead *persisted* as a cooldown deadline and returned to
the caller as `IG_RATE_LIMITED` + `retry_after_sec`. The attempt counter lives
in the same file, so successive rate-limited calls escalate 1..5 exactly as the
brief specifies, and a restart does not reset the escalation or immediately
hammer Instagram.

Every backoff decision is logged as a structured event, so the evidence for
Gate 3 proof #10 comes out of the service rather than out of a story about it.
"""

from __future__ import annotations

import json
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .logging import log_event

BASE_SECONDS = 60.0
CAP_SECONDS = 30 * 60.0
MAX_ATTEMPTS = 5


def backoff_seconds(attempt: int, *, rng: random.Random | None = None) -> float:
    """Full-jitter backoff for a 1-based attempt number.

    attempt 1 -> uniform(0, 60), 2 -> uniform(0, 120), ... ceiling capped at
    30 minutes from attempt 6 onward (unreachable given MAX_ATTEMPTS=5).
    """
    if attempt < 1:
        raise ValueError("attempt is 1-based")
    ceiling = min(CAP_SECONDS, BASE_SECONDS * (2 ** (attempt - 1)))
    r = rng or random
    return r.uniform(0.0, ceiling)


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class Cooldown:
    """A persisted 'do not talk to Instagram until' deadline + attempt counter."""

    def __init__(self, path: Path) -> None:
        self.path = path

    # -- reading -----------------------------------------------------------
    def state(self) -> dict[str, Any]:
        try:
            raw = json.loads(self.path.read_text())
        except FileNotFoundError:
            return {"until": None, "attempt": 0, "reason": None}
        except (OSError, json.JSONDecodeError) as exc:
            # A corrupt cooldown file is reported, not silently treated as
            # "no cooldown" without a trace.
            log_event(
                "ratelimit.cooldown_unreadable", path=str(self.path), error=str(exc)
            )
            return {"until": None, "attempt": 0, "reason": None}
        if not isinstance(raw, dict):
            return {"until": None, "attempt": 0, "reason": None}
        attempt = raw.get("attempt")
        return {
            "until": _parse_iso(raw.get("until")),
            "attempt": attempt if isinstance(attempt, int) and attempt >= 0 else 0,
            "reason": raw.get("reason"),
        }

    def until(self) -> datetime | None:
        return self.state()["until"]

    def remaining(self, *, now: datetime | None = None) -> float:
        deadline = self.until()
        if deadline is None:
            return 0.0
        current = now or datetime.now(timezone.utc)
        return max(0.0, (deadline - current).total_seconds())

    def attempt(self) -> int:
        """Current attempt count, reset to 0 once the cooldown has elapsed."""
        state = self.state()
        deadline = state["until"]
        if deadline is None:
            return 0
        if (deadline - datetime.now(timezone.utc)).total_seconds() <= -CAP_SECONDS:
            # Long past the deadline: the escalation has decayed.
            return 0
        return int(state["attempt"])

    # -- writing -----------------------------------------------------------
    def record_backoff(
        self,
        *,
        reason: str,
        rng: random.Random | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Escalate one attempt, persist the new deadline, log the decision."""
        attempt = self.attempt() + 1
        exhausted = attempt >= MAX_ATTEMPTS
        seconds = backoff_seconds(min(attempt, MAX_ATTEMPTS), rng=rng)
        current = now or datetime.now(timezone.utc)
        deadline = current + timedelta(seconds=seconds)
        self._write({"until": _iso(deadline), "attempt": attempt, "reason": reason})
        log_event(
            "ratelimit.backoff",
            attempt=attempt,
            max_attempts=MAX_ATTEMPTS,
            retry_after_sec=round(seconds, 3),
            until=_iso(deadline),
            reason=reason,
            attempts_exhausted=exhausted,
        )
        return {
            "attempt": attempt,
            "max_attempts": MAX_ATTEMPTS,
            "retry_after_sec": round(seconds, 3),
            "until": _iso(deadline),
            "attempts_exhausted": exhausted,
        }

    def _write(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(payload))
        os.replace(tmp, self.path)

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            return
        log_event("ratelimit.cooldown_cleared", path=str(self.path))
