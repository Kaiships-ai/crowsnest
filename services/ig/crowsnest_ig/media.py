"""Content-addressed asset storage (brief §5).

Layout: ``<MEDIA_ROOT>/<sha256[0:2]>/<sha256>.<ext>``.

The path is derived from the hash alone, so it cannot be steered out of the
media root by a hostile URL, and an unchanged asset re-downloaded later dedupes
onto the same file. A zero-byte download is an error, never a success.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

from .errors import IG_ASSET_DOWNLOAD, IG_BAD_REQUEST, IgError
from .logging import log_event
from .models import DownloadResponse

_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "application/octet-stream": "bin",
}

_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic"}
_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm"}

CHUNK_SIZE = 64 * 1024


def normalize_content_type(raw: str | None, url: str) -> str:
    """Pick a content type from the response header, falling back to the URL."""
    if raw:
        value = raw.split(";", 1)[0].strip().lower()
        if value:
            return value
    guessed, _ = mimetypes.guess_type(urlparse(url).path)
    if guessed:
        return guessed
    raise IgError(
        IG_ASSET_DOWNLOAD,
        "Could not determine a content type for the asset; refusing to guess.",
        detail={"url_path": urlparse(url).path},
    )


def extension_for(content_type: str, url: str) -> str:
    ext = _EXT_BY_CONTENT_TYPE.get(content_type)
    if ext:
        return ext
    suffix = Path(urlparse(url).path).suffix.lstrip(".").lower()
    if suffix and suffix.isalnum() and len(suffix) <= 5:
        return suffix
    guessed = mimetypes.guess_extension(content_type)
    if guessed:
        return guessed.lstrip(".")
    raise IgError(
        IG_ASSET_DOWNLOAD,
        f"No file extension known for content type {content_type!r}.",
        detail={"content_type": content_type},
    )


def relative_path_for(sha256: str, ext: str) -> str:
    if len(sha256) != 64 or not all(c in "0123456789abcdef" for c in sha256):
        raise ValueError(f"not a sha256 hex digest: {sha256!r}")
    return f"{sha256[:2]}/{sha256}.{ext}"


def validate_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise IgError(
            IG_BAD_REQUEST,
            "Asset URL must be an absolute http(s) URL.",
            detail={"url_scheme": parsed.scheme},
        )
    return url


def store_stream(
    chunks: Iterable[bytes],
    *,
    media_root: Path,
    content_type: str,
    url: str,
) -> DownloadResponse:
    """Hash a byte stream into the content-addressed store.

    Writes to a temp file first, so a failed or empty transfer never leaves a
    truncated file at a content-addressed path that a later run would trust.
    """
    media_root = Path(media_root)
    tmp_dir = media_root / ".tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256()
    total = 0
    fd, tmp_name = _mkstemp(tmp_dir)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            for chunk in chunks:
                if not chunk:
                    continue
                digest.update(chunk)
                total += len(chunk)
                handle.write(chunk)

        if total == 0:
            raise IgError(
                IG_ASSET_DOWNLOAD,
                "Downloaded 0 bytes — treating as a failure, not an empty asset.",
                detail={"content_type": content_type, "url_host": urlparse(url).netloc},
            )

        sha256 = digest.hexdigest()
        ext = extension_for(content_type, url)
        relative = relative_path_for(sha256, ext)
        target = media_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists() and target.stat().st_size == total:
            tmp_path.unlink(missing_ok=True)
            log_event("asset.deduped", sha256=sha256, path=relative, bytes=total)
            return _describe(target, relative, total, content_type, sha256, deduped=True)

        os.replace(tmp_path, target)
        os.chmod(target, 0o644)
        log_event("asset.stored", sha256=sha256, path=relative, bytes=total,
                  content_type=content_type)
        return _describe(target, relative, total, content_type, sha256, deduped=False)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def _mkstemp(directory: Path) -> tuple[int, str]:
    import tempfile

    return tempfile.mkstemp(dir=directory, prefix="dl-", suffix=".part")


def _describe(
    target: Path,
    relative: str,
    total: int,
    content_type: str,
    sha256: str,
    *,
    deduped: bool,
) -> DownloadResponse:
    width, height = (None, None)
    duration = None
    if content_type in _IMAGE_TYPES:
        width, height = probe_image(target)
    elif content_type in _VIDEO_TYPES:
        duration = probe_duration(target)
    return DownloadResponse(
        path=relative,
        bytes=total,
        content_type=content_type,
        sha256=sha256,
        width=width,
        height=height,
        duration_sec=duration,
        deduped=deduped,
    )


def probe_image(path: Path) -> tuple[int | None, int | None]:
    """Image dimensions via Pillow (already an instagrapi dependency)."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow ships with instagrapi
        return (None, None)
    try:
        with Image.open(path) as image:
            return (int(image.width), int(image.height))
    except Exception as exc:  # noqa: BLE001 - dimensions are optional metadata
        log_event("asset.dimensions_unavailable", path=str(path), error=str(exc))
        return (None, None)


def probe_duration(path: Path) -> float | None:
    """Video duration via ffprobe when it is on PATH, else null.

    Not faked: if ffprobe is absent the field is null and the caller is told
    nothing it cannot verify.
    """
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        log_event("asset.duration_unavailable", reason="ffprobe_not_on_path")
        return None
    try:
        result = subprocess.run(
            [
                ffprobe, "-v", "error", "-show_entries", "format=duration",
                "-of", "json", str(path),
            ],
            capture_output=True,
            timeout=30,
            check=True,
        )
        duration = json.loads(result.stdout)["format"]["duration"]
        return float(duration)
    except (subprocess.SubprocessError, OSError, KeyError, ValueError, json.JSONDecodeError) as exc:
        log_event("asset.duration_unavailable", path=str(path), error=str(exc))
        return None


def download(
    url: str,
    *,
    media_root: Path,
    timeout_s: float,
    session=None,
    user_agent: str | None = None,
    proxy: str | None = None,
) -> DownloadResponse:
    """Fetch an Instagram CDN URL into the content-addressed store."""
    import requests

    validate_url(url)
    http = session or requests.Session()
    headers = {"User-Agent": user_agent} if user_agent else {}
    proxies = {"http": proxy, "https": proxy} if proxy else None

    try:
        response = http.get(
            url, stream=True, timeout=timeout_s, headers=headers, proxies=proxies
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        raise IgError(
            IG_ASSET_DOWNLOAD,
            f"Asset download failed: {type(exc).__name__}",
            detail={
                "url_host": urlparse(url).netloc,
                "status": status,
                "upstream_message": str(exc),
            },
        ) from exc

    content_type = normalize_content_type(response.headers.get("Content-Type"), url)
    with response:
        return store_stream(
            response.iter_content(chunk_size=CHUNK_SIZE),
            media_root=media_root,
            content_type=content_type,
            url=url,
        )
