"""Pure mapping: instagrapi payload dicts -> DTOs, plus the lookback boundary.

Everything here is side-effect free and network free, which is what makes the
drift policy and the boundary rule testable offline.

Drift policy (brief §7):
  * required fields (pk, code, taken_at, media_type) missing or of the wrong
    type -> DriftError, loudly, with the raw payload attached;
  * unknown / new fields -> ignored, never fatal;
  * optional fields absent -> null.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .errors import DriftError
from .models import ChildDTO, MediaDTO, ProfileDTO

# instagrapi/Instagram media_type integers.
_MEDIA_TYPE_BY_INT: dict[int, str] = {1: "photo", 2: "video", 8: "carousel"}

# Keys Instagram has used to flag a profile-grid pin. Absence is not an error.
_PIN_KEYS = (
    "is_pinned",
    "timeline_pinned_user_ids",
    "is_pinned_to_profile",
    "pinned_to_profile",
)


def _require(raw: dict[str, Any], field: str) -> Any:
    if field not in raw or raw[field] is None:
        raise DriftError(
            f"required field {field!r} missing from Instagram payload",
            raw,
            field=field,
        )
    return raw[field]


def _as_str(value: Any, field: str, raw: dict[str, Any]) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise DriftError(
            f"required field {field!r} has wrong type {type(value).__name__}",
            raw,
            field=field,
        )
    text = str(value).strip()
    if not text:
        raise DriftError(f"required field {field!r} is empty", raw, field=field)
    return text


def _opt_int(raw: dict[str, Any], field: str) -> int | None:
    value = raw.get(field)
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value)
    return None


def _opt_float(raw: dict[str, Any], field: str) -> float | None:
    value = raw.get(field)
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _opt_str(raw: dict[str, Any], field: str) -> str | None:
    value = raw.get(field)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_taken_at(value: Any, raw: dict[str, Any]) -> datetime:
    """Accept datetime, epoch seconds, or ISO-8601; anything else is drift."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, bool):
        raise DriftError("taken_at is a bool", raw, field="taken_at")
    elif isinstance(value, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise DriftError(
                f"taken_at epoch {value!r} is not a representable timestamp",
                raw,
                field="taken_at",
            ) from exc
    elif isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError as exc:
            raise DriftError(
                f"taken_at {value!r} is not ISO-8601", raw, field="taken_at"
            ) from exc
    else:
        raise DriftError(
            f"taken_at has wrong type {type(value).__name__}", raw, field="taken_at"
        )
    if dt.tzinfo is None:
        # instagrapi hands back naive UTC datetimes in some code paths.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_media_type(raw: dict[str, Any]) -> str:
    value = _require(raw, "media_type")
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise DriftError(
            f"media_type has wrong type {type(value).__name__}", raw, field="media_type"
        )
    if isinstance(value, str):
        if value in ("photo", "video", "carousel"):
            return value
        if value.strip().isdigit():
            value = int(value)
        else:
            raise DriftError(f"media_type {value!r} unrecognised", raw, field="media_type")
    kind = _MEDIA_TYPE_BY_INT.get(int(value))
    if kind is None:
        raise DriftError(
            f"media_type {value!r} is not one of {sorted(_MEDIA_TYPE_BY_INT)}",
            raw,
            field="media_type",
        )
    return kind


def detect_pinned(raw: dict[str, Any]) -> bool:
    """Best-effort pin detection.

    instagrapi 2.18.9's `Media` model does not expose a pin flag, so this only
    fires when the raw private-API dict carries one. It is a refinement of the
    3-consecutive rule, not a substitute for it.
    """
    for key in _PIN_KEYS:
        value = raw.get(key)
        if isinstance(value, bool) and value:
            return True
        if isinstance(value, (list, tuple)) and len(value) > 0:
            return True
    return False


def _child_to_dto(raw: dict[str, Any], position: int) -> ChildDTO:
    pk = _as_str(_require(raw, "pk"), "pk", raw)
    return ChildDTO(
        position=position,
        pk=pk,
        media_type=parse_media_type(raw),
        thumbnail_url=_opt_str(raw, "thumbnail_url"),
        video_url=_opt_str(raw, "video_url"),
        raw=raw,
    )


def children_from_media(raw: dict[str, Any]) -> list[ChildDTO]:
    """Carousel children, in payload order, positions 0..n-1.

    A `Resource` carries only pk/video_url/thumbnail_url/media_type/usertags —
    it has no taken_at and no caption, so those are inherited from the parent by
    the consumer rather than invented here.
    """
    resources = raw.get("resources")
    if not isinstance(resources, (list, tuple)):
        return []
    return [_child_to_dto(dict(child), index) for index, child in enumerate(resources)]


def media_to_dto(raw: dict[str, Any]) -> MediaDTO:
    if not isinstance(raw, dict):
        raise DriftError(
            f"media payload is {type(raw).__name__}, expected dict", raw
        )
    pk = _as_str(_require(raw, "pk"), "pk", raw)
    code = _as_str(_require(raw, "code"), "code", raw)
    taken_at = parse_taken_at(_require(raw, "taken_at"), raw)
    media_type = parse_media_type(raw)

    children = children_from_media(raw)
    if media_type == "carousel" and not children:
        raise DriftError(
            "carousel media has no resources[] — children cannot be reconstructed",
            raw,
            field="resources",
        )

    return MediaDTO(
        pk=pk,
        code=code,
        permalink=f"https://www.instagram.com/p/{code}/",
        taken_at=taken_at.isoformat().replace("+00:00", "Z"),
        media_type=media_type,
        product_type=_opt_str(raw, "product_type"),
        caption=_opt_str(raw, "caption_text"),
        thumbnail_url=_opt_str(raw, "thumbnail_url"),
        video_url=_opt_str(raw, "video_url"),
        duration_sec=_opt_float(raw, "video_duration"),
        view_count=_opt_int(raw, "view_count"),
        play_count=_opt_int(raw, "play_count"),
        like_count=_opt_int(raw, "like_count"),
        comment_count=_opt_int(raw, "comment_count"),
        is_pinned=detect_pinned(raw),
        children=children,
        raw=raw,
    )


def profile_to_dto(raw: dict[str, Any]) -> ProfileDTO:
    if not isinstance(raw, dict):
        raise DriftError(f"profile payload is {type(raw).__name__}, expected dict", raw)
    pk = _as_str(_require(raw, "pk"), "pk", raw)
    username = _as_str(_require(raw, "username"), "username", raw)
    return ProfileDTO(
        pk=pk,
        username=username,
        full_name=_opt_str(raw, "full_name"),
        biography=_opt_str(raw, "biography"),
        follower_count=_opt_int(raw, "follower_count"),
        following_count=_opt_int(raw, "following_count"),
        media_count=_opt_int(raw, "media_count"),
        is_private=bool(raw.get("is_private", False)),
        is_verified=bool(raw.get("is_verified", False)),
        profile_pic_url=_opt_str(raw, "profile_pic_url_hd")
        or _opt_str(raw, "profile_pic_url"),
        external_url=_opt_str(raw, "external_url"),
        raw=raw,
    )


# --------------------------------------------------------------------------
# Lookback boundary — brief §6
# --------------------------------------------------------------------------
CONSECUTIVE_OUT_OF_WINDOW_LIMIT = 3


def apply_lookback(
    items: list[MediaDTO],
    *,
    since: datetime | None,
    max_items: int | None,
    already_kept: int = 0,
    consecutive_out: int = 0,
    consecutive_limit: int = CONSECUTIVE_OUT_OF_WINDOW_LIMIT,
) -> tuple[list[MediaDTO], str, int]:
    """Filter one newest-first page against the lookback window.

    Do NOT stop on the first out-of-window item: pinned posts can appear first
    and out of chronological order. Stop only after `consecutive_limit`
    consecutive out-of-window items. An item flagged as pinned never counts
    toward that streak.

    Returns (kept, stop_reason, consecutive_out_carry).
    stop_reason is one of: "lookback", "cap", "page".
    """
    if consecutive_limit < 1:
        raise ValueError("consecutive_limit must be >= 1")

    kept: list[MediaDTO] = []
    streak = consecutive_out
    total = already_kept

    for item in items:
        if max_items is not None and total >= max_items:
            return kept, "cap", streak

        if since is not None and _taken_at(item) < since:
            if item.is_pinned:
                # Pinned items are out of chronological order by construction;
                # they are never a boundary signal.
                continue
            streak += 1
            if streak >= consecutive_limit:
                return kept, "lookback", streak
            continue

        streak = 0
        kept.append(item)
        total += 1

    if max_items is not None and total >= max_items:
        return kept, "cap", streak
    return kept, "page", streak


def _taken_at(item: MediaDTO) -> datetime:
    return datetime.fromisoformat(item.taken_at.replace("Z", "+00:00"))
