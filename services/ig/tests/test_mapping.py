"""Mapping, drift policy, carousel children and the lookback boundary.

The payload shapes below mirror what instagrapi 2.18.9 actually produces:
`Media` carries pk/id/code/taken_at/media_type/product_type/thumbnail_url/
video_url/video_duration/view_count/play_count/like_count/comment_count/
caption_text/resources/usertags/user/clips_metadata; a carousel child
(`Resource`) carries ONLY pk/video_url/thumbnail_url/media_type/usertags.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from crowsnest_ig.errors import DriftError
from crowsnest_ig.mapping import (
    apply_lookback,
    children_from_media,
    media_to_dto,
    parse_taken_at,
    profile_to_dto,
)

NOW = datetime(2026, 7, 27, 12, 0, 0, tzinfo=timezone.utc)


def reel(pk: str = "3111111111111111111", **overrides: object) -> dict:
    payload = {
        "pk": pk,
        "id": f"{pk}_1787",
        "code": "CxYzAbCdEfG",
        "taken_at": "2026-07-20T09:30:00+00:00",
        "media_type": 2,
        "product_type": "clips",
        "thumbnail_url": "https://scontent.cdninstagram.com/v/t51/thumb.jpg",
        "video_url": "https://scontent.cdninstagram.com/v/t50/reel.mp4",
        "video_duration": 31.5,
        "view_count": 120_000,
        "play_count": 131_000,
        "like_count": 8_400,
        "comment_count": 212,
        "caption_text": "how i ship in public",
        "resources": [],
        "usertags": [],
        "clips_metadata": {"music_info": None},
    }
    payload.update(overrides)
    return payload


def carousel(**overrides: object) -> dict:
    payload = reel(
        pk="3222222222222222222",
        media_type=8,
        product_type="carousel_container",
        video_url=None,
        video_duration=None,
        resources=[
            {
                "pk": "3222222222222222223",
                "video_url": None,
                "thumbnail_url": "https://scontent.cdninstagram.com/v/child0.jpg",
                "media_type": 1,
                "usertags": [],
            },
            {
                "pk": "3222222222222222224",
                "video_url": "https://scontent.cdninstagram.com/v/child1.mp4",
                "thumbnail_url": "https://scontent.cdninstagram.com/v/child1.jpg",
                "media_type": 2,
                "usertags": [],
            },
            {
                "pk": "3222222222222222225",
                "video_url": None,
                "thumbnail_url": "https://scontent.cdninstagram.com/v/child2.jpg",
                "media_type": 1,
                "usertags": [],
            },
        ],
    )
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------- mapping ---
def test_reel_maps_to_dto() -> None:
    dto = media_to_dto(reel())
    assert dto.pk == "3111111111111111111"
    assert dto.code == "CxYzAbCdEfG"
    assert dto.permalink == "https://www.instagram.com/p/CxYzAbCdEfG/"
    assert dto.taken_at == "2026-07-20T09:30:00Z"
    assert dto.media_type == "video"
    assert dto.product_type == "clips"
    assert dto.caption == "how i ship in public"
    assert dto.duration_sec == 31.5
    assert dto.view_count == 120_000
    assert dto.raw["clips_metadata"] == {"music_info": None}


def test_photo_and_carousel_media_types() -> None:
    assert media_to_dto(reel(media_type=1, video_url=None)).media_type == "photo"
    assert media_to_dto(carousel()).media_type == "carousel"


def test_unknown_fields_are_ignored_not_fatal() -> None:
    dto = media_to_dto(reel(some_field_meta_added_yesterday={"a": 1}))
    assert dto.pk == "3111111111111111111"
    assert dto.raw["some_field_meta_added_yesterday"] == {"a": 1}


def test_absent_optional_fields_become_null() -> None:
    payload = reel()
    for key in ("caption_text", "video_url", "video_duration", "view_count",
                "play_count", "like_count", "comment_count", "product_type"):
        payload.pop(key)
    dto = media_to_dto(payload)
    assert dto.caption is None
    assert dto.video_url is None
    assert dto.duration_sec is None
    assert dto.view_count is None
    assert dto.product_type is None


@pytest.mark.parametrize("field", ["pk", "code", "taken_at", "media_type"])
def test_missing_required_field_raises_drift_with_raw(field: str) -> None:
    payload = reel()
    payload.pop(field)
    with pytest.raises(DriftError) as excinfo:
        media_to_dto(payload)
    assert excinfo.value.detail["field"] == field
    assert excinfo.value.detail["raw"] == payload


@pytest.mark.parametrize(
    "field,value",
    [("pk", {"nested": 1}), ("code", []), ("taken_at", ["nope"]), ("media_type", 99)],
)
def test_wrong_type_required_field_raises_drift(field: str, value: object) -> None:
    payload = reel(**{field: value})
    with pytest.raises(DriftError):
        media_to_dto(payload)


def test_taken_at_accepts_epoch_datetime_and_iso() -> None:
    raw = reel()
    assert parse_taken_at(1_753_000_000, raw).year == 2025
    assert parse_taken_at(datetime(2026, 1, 2, 3, 4), raw).tzinfo == timezone.utc
    assert parse_taken_at("2026-07-20T09:30:00Z", raw).hour == 9


def test_carousel_without_resources_is_drift() -> None:
    with pytest.raises(DriftError, match="no resources"):
        media_to_dto(carousel(resources=[]))


# --------------------------------------------------------------- children ---
def test_carousel_children_are_extracted_with_positions() -> None:
    dto = media_to_dto(carousel())
    assert [c.position for c in dto.children] == [0, 1, 2]
    assert [c.pk for c in dto.children] == [
        "3222222222222222223",
        "3222222222222222224",
        "3222222222222222225",
    ]
    assert [c.media_type for c in dto.children] == ["photo", "video", "photo"]
    assert dto.children[1].video_url.endswith("child1.mp4")
    assert dto.children[0].video_url is None
    # A Resource has no taken_at / caption of its own; nothing is invented.
    assert "taken_at" not in dto.children[0].raw
    assert "caption_text" not in dto.children[0].raw


def test_non_carousel_has_no_children() -> None:
    assert media_to_dto(reel()).children == []
    assert children_from_media(reel(resources=None)) == []


def test_child_missing_pk_is_drift() -> None:
    payload = carousel()
    del payload["resources"][1]["pk"]
    with pytest.raises(DriftError):
        media_to_dto(payload)


# --------------------------------------------------------------- boundary ---
def _item(days_ago: float, *, pk: str, pinned: bool = False):
    taken = NOW - timedelta(days=days_ago)
    payload = reel(pk=pk, taken_at=taken.isoformat())
    if pinned:
        payload["is_pinned"] = True
    return media_to_dto(payload)


def test_does_not_stop_on_the_first_out_of_window_item() -> None:
    """Pinned-or-not, one old item must not end the walk (brief §6)."""
    since = NOW - timedelta(days=30)
    items = [
        _item(400, pk="1"),   # out of window, e.g. an old pinned post
        _item(1, pk="2"),     # in window
        _item(2, pk="3"),     # in window
    ]
    kept, stop_reason, streak = apply_lookback(items, since=since, max_items=None)
    assert stop_reason == "page"
    assert [i.pk for i in kept] == ["2", "3"]
    assert streak == 0


def test_two_out_of_window_items_still_do_not_stop() -> None:
    since = NOW - timedelta(days=30)
    items = [_item(400, pk="1"), _item(500, pk="2"), _item(1, pk="3")]
    kept, stop_reason, streak = apply_lookback(items, since=since, max_items=None)
    assert stop_reason == "page"
    assert [i.pk for i in kept] == ["3"]
    assert streak == 0


def test_three_consecutive_out_of_window_items_stop_the_walk() -> None:
    since = NOW - timedelta(days=30)
    items = [
        _item(1, pk="in-1"),
        _item(400, pk="old-1"),
        _item(401, pk="old-2"),
        _item(402, pk="old-3"),   # third consecutive -> stop here
        _item(2, pk="never-seen"),
    ]
    kept, stop_reason, streak = apply_lookback(items, since=since, max_items=None)
    assert stop_reason == "lookback"
    assert [i.pk for i in kept] == ["in-1"]
    assert streak == 3


def test_streak_resets_when_an_in_window_item_appears() -> None:
    since = NOW - timedelta(days=30)
    items = [
        _item(400, pk="old-1"),
        _item(401, pk="old-2"),
        _item(3, pk="in-1"),      # resets the streak
        _item(402, pk="old-3"),
        _item(403, pk="old-4"),
        _item(4, pk="in-2"),
    ]
    kept, stop_reason, _ = apply_lookback(items, since=since, max_items=None)
    assert stop_reason == "page"
    assert [i.pk for i in kept] == ["in-1", "in-2"]


def test_pinned_out_of_window_item_never_counts_toward_the_streak() -> None:
    since = NOW - timedelta(days=30)
    items = [
        _item(400, pk="pin-1", pinned=True),
        _item(401, pk="pin-2", pinned=True),
        _item(402, pk="pin-3", pinned=True),
        _item(1, pk="in-1"),
    ]
    kept, stop_reason, streak = apply_lookback(items, since=since, max_items=None)
    assert stop_reason == "page"
    assert [i.pk for i in kept] == ["in-1"]
    assert streak == 0


def test_streak_carries_across_page_boundaries() -> None:
    since = NOW - timedelta(days=30)
    page_two = [_item(500, pk="old-3"), _item(1, pk="unreachable")]
    kept, stop_reason, _ = apply_lookback(
        page_two, since=since, max_items=None, consecutive_out=2
    )
    assert stop_reason == "lookback"
    assert kept == []


def test_max_items_cap() -> None:
    items = [_item(1, pk=str(i)) for i in range(5)]
    kept, stop_reason, _ = apply_lookback(items, since=None, max_items=3)
    assert stop_reason == "cap"
    assert len(kept) == 3


def test_cap_accounts_for_items_kept_on_earlier_pages() -> None:
    items = [_item(1, pk=str(i)) for i in range(5)]
    kept, stop_reason, _ = apply_lookback(
        items, since=None, max_items=3, already_kept=2
    )
    assert stop_reason == "cap"
    assert len(kept) == 1


def test_no_boundary_keeps_everything() -> None:
    items = [_item(900, pk="a"), _item(1, pk="b")]
    kept, stop_reason, _ = apply_lookback(items, since=None, max_items=None)
    assert stop_reason == "page"
    assert len(kept) == 2


def test_configurable_limit_is_validated() -> None:
    with pytest.raises(ValueError):
        apply_lookback([], since=None, max_items=None, consecutive_limit=0)


# ---------------------------------------------------------------- profile ---
def test_profile_mapping() -> None:
    dto = profile_to_dto(
        {
            "pk": "1234567",
            "username": "kallaway",
            "full_name": "Kallaway",
            "biography": "content strategy",
            "follower_count": 442288,
            "following_count": 512,
            "media_count": 1180,
            "is_private": False,
            "is_verified": True,
            "profile_pic_url": "https://scontent.cdninstagram.com/small.jpg",
            "profile_pic_url_hd": "https://scontent.cdninstagram.com/hd.jpg",
            "external_url": "https://kallaway.com",
        }
    )
    assert dto.pk == "1234567"
    assert dto.follower_count == 442288
    assert dto.is_verified is True
    assert dto.profile_pic_url.endswith("hd.jpg")


def test_profile_missing_username_is_drift() -> None:
    with pytest.raises(DriftError):
        profile_to_dto({"pk": "1"})
