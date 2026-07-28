from __future__ import annotations

import pytest

from crowsnest_ig.config import REPO_ROOT, ConfigError, load_config

GOOD_TOKEN = "0123456789abcdef01"


def test_missing_service_token_refuses_to_start() -> None:
    with pytest.raises(ConfigError) as excinfo:
        load_config({})
    assert "IG_SERVICE_TOKEN is required" in str(excinfo.value)


def test_short_service_token_refused() -> None:
    with pytest.raises(ConfigError, match="at least 16 characters"):
        load_config({"IG_SERVICE_TOKEN": "short"})


def test_boots_with_only_the_token() -> None:
    cfg = load_config({"IG_SERVICE_TOKEN": GOOD_TOKEN})
    assert cfg.can_login is False
    assert cfg.host == "127.0.0.1"
    assert cfg.port == 8765
    assert cfg.session_path == (REPO_ROOT / "data/ig-session.json").resolve()
    assert cfg.media_root == (REPO_ROOT / "data/media").resolve()
    assert cfg.request_timeout_ms == 30_000
    assert cfg.download_timeout_ms == 120_000


def test_credentials_must_be_set_together() -> None:
    with pytest.raises(ConfigError, match="must be set together"):
        load_config({"IG_SERVICE_TOKEN": GOOD_TOKEN, "IG_USERNAME": "someone"})


def test_non_loopback_host_refused() -> None:
    with pytest.raises(ConfigError, match="loopback only"):
        load_config({"IG_SERVICE_TOKEN": GOOD_TOKEN, "IG_SERVICE_HOST": "0.0.0.0"})


def test_malformed_int_refused() -> None:
    with pytest.raises(ConfigError, match="must be an integer"):
        load_config({"IG_SERVICE_TOKEN": GOOD_TOKEN, "IG_SERVICE_PORT": "eight"})


def test_relative_paths_resolve_against_repo_root() -> None:
    cfg = load_config(
        {
            "IG_SERVICE_TOKEN": GOOD_TOKEN,
            "MEDIA_ROOT": "tmp/assets",
            "IG_SESSION_PATH": "tmp/sess.json",
        }
    )
    assert cfg.media_root == (REPO_ROOT / "tmp/assets").resolve()
    assert cfg.cooldown_path.name == "sess.json.cooldown"


def test_device_seed_defaults_to_username() -> None:
    cfg = load_config(
        {
            "IG_SERVICE_TOKEN": GOOD_TOKEN,
            "IG_USERNAME": "Burner",
            "IG_PASSWORD": "hunter2",
        }
    )
    assert cfg.effective_device_seed() == "crowsnest:burner"
    assert cfg.can_login is True


def test_device_seed_without_username_is_an_error() -> None:
    cfg = load_config({"IG_SERVICE_TOKEN": GOOD_TOKEN})
    with pytest.raises(ConfigError, match="Cannot derive a device seed"):
        cfg.effective_device_seed()
