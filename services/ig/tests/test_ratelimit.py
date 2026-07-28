from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from crowsnest_ig.ratelimit import BASE_SECONDS, CAP_SECONDS, MAX_ATTEMPTS, Cooldown, backoff_seconds


def test_full_jitter_bounds() -> None:
    rng = random.Random(1234)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        ceiling = min(CAP_SECONDS, BASE_SECONDS * 2 ** (attempt - 1))
        for _ in range(200):
            value = backoff_seconds(attempt, rng=rng)
            assert 0.0 <= value <= ceiling


def test_jitter_is_full_not_equal_jitter() -> None:
    rng = random.Random(7)
    samples = [backoff_seconds(3, rng=rng) for _ in range(500)]
    # Full jitter draws from [0, ceiling); equal jitter would floor at ceiling/2.
    assert min(samples) < (BASE_SECONDS * 4) / 2


def test_ceiling_is_capped_at_thirty_minutes() -> None:
    rng = random.Random(0)
    assert backoff_seconds(20, rng=rng) <= CAP_SECONDS


def test_attempt_is_one_based() -> None:
    with pytest.raises(ValueError):
        backoff_seconds(0)


def test_cooldown_round_trips_and_escalates(tmp_path: Path) -> None:
    cooldown = Cooldown(tmp_path / "sess.json.cooldown")
    assert cooldown.remaining() == 0.0
    assert cooldown.attempt() == 0

    first = cooldown.record_backoff(reason="FeedbackRequired", rng=random.Random(1))
    assert first["attempt"] == 1
    assert first["attempts_exhausted"] is False
    assert 0 <= first["retry_after_sec"] <= BASE_SECONDS

    second = cooldown.record_backoff(reason="FeedbackRequired", rng=random.Random(2))
    assert second["attempt"] == 2


def test_cooldown_survives_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "sess.json.cooldown"
    Cooldown(path).record_backoff(reason="RateLimitError", rng=random.Random(3))

    # A brand-new process reading the same file must see the escalation.
    reborn = Cooldown(path)
    assert reborn.attempt() == 1
    assert reborn.until() is not None


def test_attempts_exhaust_at_the_documented_maximum(tmp_path: Path) -> None:
    cooldown = Cooldown(tmp_path / "cd")
    results = [
        cooldown.record_backoff(reason="x", rng=random.Random(i))
        for i in range(MAX_ATTEMPTS)
    ]
    assert [r["attempt"] for r in results] == list(range(1, MAX_ATTEMPTS + 1))
    assert results[-1]["attempts_exhausted"] is True
    assert all(r["attempts_exhausted"] is False for r in results[:-1])


def test_remaining_is_zero_once_the_deadline_passes(tmp_path: Path) -> None:
    path = tmp_path / "cd"
    path.write_text(
        '{"until": "2000-01-01T00:00:00Z", "attempt": 2, "reason": "old"}'
    )
    cooldown = Cooldown(path)
    assert cooldown.remaining() == 0.0
    # Long-elapsed escalation decays back to zero rather than sticking forever.
    assert cooldown.attempt() == 0


def test_recent_escalation_is_retained(tmp_path: Path) -> None:
    path = tmp_path / "cd"
    recent = datetime.now(timezone.utc) - timedelta(seconds=5)
    path.write_text(
        f'{{"until": "{recent.isoformat().replace("+00:00", "Z")}", '
        f'"attempt": 3, "reason": "FeedbackRequired"}}'
    )
    assert Cooldown(path).attempt() == 3


def test_corrupt_cooldown_file_does_not_crash(tmp_path: Path) -> None:
    path = tmp_path / "cd"
    path.write_text("{not json")
    cooldown = Cooldown(path)
    assert cooldown.state() == {"until": None, "attempt": 0, "reason": None}


def test_clear_removes_the_file(tmp_path: Path) -> None:
    path = tmp_path / "cd"
    cooldown = Cooldown(path)
    cooldown.record_backoff(reason="x", rng=random.Random(4))
    assert path.exists()
    cooldown.clear()
    assert not path.exists()
    cooldown.clear()  # idempotent
