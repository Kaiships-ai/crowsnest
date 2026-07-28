from __future__ import annotations

from pathlib import Path

import pytest

from crowsnest_ig.config import Config

TOKEN = "test-token-0123456789"


@pytest.fixture()
def config(tmp_path: Path) -> Config:
    return Config(
        service_token=TOKEN,
        username=None,
        password=None,
        session_path=tmp_path / "ig-session.json",
        media_root=tmp_path / "media",
        locale="en_US",
        country="US",
        timezone_offset_s=0,
        proxy=None,
        device_seed="unit-test-seed",
        host="127.0.0.1",
        port=8765,
        request_timeout_ms=30_000,
        download_timeout_ms=120_000,
    )
