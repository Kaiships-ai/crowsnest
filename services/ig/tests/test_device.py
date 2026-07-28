from __future__ import annotations

import uuid

from crowsnest_ig.device import DEVICE_POOL, derive_device, derive_uuids


def test_uuids_are_stable_for_a_seed() -> None:
    a = derive_uuids("crowsnest:burner")
    b = derive_uuids("crowsnest:burner")
    assert a == b


def test_uuids_differ_between_seeds() -> None:
    a = derive_uuids("crowsnest:burner")
    b = derive_uuids("crowsnest:other")
    assert a != b
    assert a["android_device_id"] != b["android_device_id"]


def test_uuid_shape_matches_instagrapi_expectations() -> None:
    values = derive_uuids("seed")
    for key in ("phone_id", "uuid", "client_session_id", "advertising_id",
                "request_id", "tray_session_id"):
        parsed = uuid.UUID(values[key])
        assert parsed.version == 4
        assert str(parsed) == values[key]
    android = values["android_device_id"]
    assert android.startswith("android-")
    assert len(android) == len("android-") + 16
    int(android.removeprefix("android-"), 16)


def test_device_profile_is_stable_and_from_the_pool() -> None:
    first = derive_device("crowsnest:burner")
    assert first == derive_device("crowsnest:burner")
    assert first in DEVICE_POOL


def test_device_profiles_carry_every_field_instagrapi_reads() -> None:
    required = {
        "android_version", "android_release", "dpi", "resolution",
        "manufacturer", "device", "model", "cpu",
    }
    for profile in DEVICE_POOL:
        assert required <= set(profile)
