"""Deterministic device + uuid pinning.

Instagram flags accounts whose device fingerprint changes between sessions. The
seed (`IG_DEVICE_SEED`, else a constant derived from the username) makes every
restart present the same phone with the same uuids, even if the session blob is
lost.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

# A small pool of plausible, currently-shipping Android profiles. The seed picks
# one; it never rotates for a given seed.
DEVICE_POOL: list[dict[str, Any]] = [
    {
        "android_version": 34,
        "android_release": "14",
        "dpi": "480dpi",
        "resolution": "1344x2992",
        "manufacturer": "Google/google",
        "device": "husky",
        "model": "Pixel 8 Pro",
        "cpu": "husky",
    },
    {
        "android_version": 33,
        "android_release": "13",
        "dpi": "420dpi",
        "resolution": "1080x2340",
        "manufacturer": "samsung",
        "device": "r11q",
        "model": "SM-S901B",
        "cpu": "exynos2200",
    },
    {
        "android_version": 34,
        "android_release": "14",
        "dpi": "440dpi",
        "resolution": "1080x2400",
        "manufacturer": "OnePlus",
        "device": "OP595DL1",
        "model": "CPH2449",
        "cpu": "taro",
    },
]

_UUID_KEYS = (
    "phone_id",
    "uuid",
    "client_session_id",
    "advertising_id",
    "request_id",
    "tray_session_id",
)


def _digest(seed: str, key: str) -> bytes:
    return hashlib.sha256(f"{seed}|{key}".encode("utf-8")).digest()


def stable_uuid(seed: str, key: str) -> str:
    raw = bytearray(_digest(seed, key)[:16])
    raw[6] = (raw[6] & 0x0F) | 0x40  # version 4
    raw[8] = (raw[8] & 0x3F) | 0x80  # RFC 4122 variant
    return str(uuid.UUID(bytes=bytes(raw)))


def stable_android_device_id(seed: str) -> str:
    return "android-" + _digest(seed, "android_device_id")[:8].hex()


def derive_uuids(seed: str) -> dict[str, str]:
    uuids = {key: stable_uuid(seed, key) for key in _UUID_KEYS}
    uuids["android_device_id"] = stable_android_device_id(seed)
    return uuids


def derive_device(seed: str) -> dict[str, Any]:
    index = _digest(seed, "device_profile")[0] % len(DEVICE_POOL)
    return dict(DEVICE_POOL[index])
