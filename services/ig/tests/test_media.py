from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from crowsnest_ig.errors import IgError
from crowsnest_ig.media import (
    extension_for,
    normalize_content_type,
    relative_path_for,
    store_stream,
    validate_url,
)

URL = "https://scontent.cdninstagram.com/v/t51/thumb.jpg"


def test_content_addressed_path_layout(tmp_path: Path) -> None:
    body = b"\xff\xd8\xff\xe0 fake jpeg bytes"
    expected = hashlib.sha256(body).hexdigest()

    result = store_stream(
        [body], media_root=tmp_path, content_type="image/jpeg", url=URL
    )

    assert result.sha256 == expected
    assert result.path == f"{expected[:2]}/{expected}.jpg"
    assert result.bytes == len(body)
    assert result.deduped is False
    stored = tmp_path / result.path
    assert stored.is_file()
    assert stored.read_bytes() == body
    assert stored.parent.name == expected[:2]


def test_repeat_download_dedupes_to_the_same_file(tmp_path: Path) -> None:
    body = b"same bytes every time"
    first = store_stream([body], media_root=tmp_path, content_type="image/png", url=URL)
    second = store_stream(
        [body[:5], body[5:]], media_root=tmp_path, content_type="image/png", url=URL
    )

    assert first.sha256 == second.sha256
    assert first.path == second.path
    assert second.deduped is True
    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert len(files) == 1


def test_zero_bytes_is_an_error_not_a_success(tmp_path: Path) -> None:
    with pytest.raises(IgError) as excinfo:
        store_stream([], media_root=tmp_path, content_type="image/jpeg", url=URL)
    assert excinfo.value.code == "IG_ASSET_DOWNLOAD"
    assert list(tmp_path.rglob("*.jpg")) == []


def test_empty_chunks_only_is_also_zero_bytes(tmp_path: Path) -> None:
    with pytest.raises(IgError):
        store_stream(
            [b"", b""], media_root=tmp_path, content_type="image/jpeg", url=URL
        )


def test_no_partial_file_left_behind_when_the_stream_explodes(tmp_path: Path) -> None:
    def exploding():
        yield b"first chunk"
        raise ConnectionResetError("connection dropped mid-transfer")

    with pytest.raises(ConnectionResetError):
        store_stream(
            exploding(), media_root=tmp_path, content_type="video/mp4", url=URL
        )
    leftovers = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert leftovers == []


def test_image_dimensions_are_read_from_the_stored_file(tmp_path: Path) -> None:
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (321, 123), (10, 20, 30)).save(buffer, format="PNG")
    result = store_stream(
        [buffer.getvalue()], media_root=tmp_path, content_type="image/png", url=URL
    )
    assert (result.width, result.height) == (321, 123)


def test_relative_path_rejects_anything_but_a_digest() -> None:
    with pytest.raises(ValueError):
        relative_path_for("../../etc/passwd", "jpg")
    with pytest.raises(ValueError):
        relative_path_for("ZZ" * 32, "jpg")


def test_extension_resolution() -> None:
    assert extension_for("image/jpeg", URL) == "jpg"
    assert extension_for("video/mp4", "https://x/y/reel.mp4") == "mp4"
    # Unknown content type falls back to the URL suffix rather than guessing.
    assert extension_for("application/x-weird", "https://x/y/thing.webp") == "webp"


def test_content_type_falls_back_to_the_url() -> None:
    assert normalize_content_type(None, URL) == "image/jpeg"
    assert normalize_content_type("image/jpeg; charset=binary", URL) == "image/jpeg"
    with pytest.raises(IgError):
        normalize_content_type(None, "https://x/y/no-extension")


def test_url_validation_rejects_non_http() -> None:
    for bad in ("file:///etc/passwd", "ftp://host/x.jpg", "not a url"):
        with pytest.raises(IgError):
            validate_url(bad)
    assert validate_url(URL) == URL
