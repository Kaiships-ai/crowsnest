"""Response DTOs. These shapes are the Node contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MediaKind = Literal["photo", "video", "carousel"]
AssetKind = Literal["thumbnail", "video", "avatar"]


class ChildDTO(BaseModel):
    position: int
    pk: str
    media_type: MediaKind
    thumbnail_url: str | None = None
    video_url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class MediaDTO(BaseModel):
    pk: str
    code: str
    permalink: str
    taken_at: str  # ISO-8601 UTC
    media_type: MediaKind
    product_type: str | None = None
    caption: str | None = None
    thumbnail_url: str | None = None
    video_url: str | None = None
    duration_sec: float | None = None
    view_count: int | None = None
    play_count: int | None = None
    like_count: int | None = None
    comment_count: int | None = None
    is_pinned: bool = False
    children: list[ChildDTO] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class ProfileDTO(BaseModel):
    pk: str
    username: str
    full_name: str | None = None
    biography: str | None = None
    follower_count: int | None = None
    following_count: int | None = None
    media_count: int | None = None
    is_private: bool = False
    is_verified: bool = False
    profile_pic_url: str | None = None
    external_url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class MediasResponse(BaseModel):
    items: list[MediaDTO]
    next_cursor: str | None = None
    stop_reason: Literal["lookback", "cap", "exhausted", "page"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    logged_in: bool
    username: str | None
    instagrapi_version: str
    session_loaded: bool
    session_path: str
    media_root: str
    can_login: bool
    cooldown_until: str | None = None


class LoginRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    verification_code: str | None = None


class LoginResponse(BaseModel):
    status: Literal["ok", "two_factor_required", "challenge_required"]
    username: str | None = None
    # Present when status == "challenge_required".
    stage: Literal["choice", "code"] | None = None
    channels: list[str] | None = None
    message: str | None = None


class ChallengeResolveRequest(BaseModel):
    choice: Literal["email", "sms"] | None = None
    code: str | None = None


class TwoFactorRequest(BaseModel):
    code: str


class SessionImportRequest(BaseModel):
    """The `sessionid` cookie from a browser already signed in to Instagram.

    Used to adopt an existing web session when the private-API login path is
    being refused despite correct credentials.
    """

    sessionid: str


class DownloadRequest(BaseModel):
    url: str
    kind: AssetKind
    media_pk: str | None = None


class DownloadResponse(BaseModel):
    path: str  # relative to MEDIA_ROOT
    bytes: int
    content_type: str
    sha256: str
    width: int | None = None
    height: int | None = None
    duration_sec: float | None = None
    deduped: bool = False


class ResolveMediaRequest(BaseModel):
    pk: str


class ResolveMediaResponse(BaseModel):
    pk: str
    media_type: MediaKind
    thumbnail_url: str | None = None
    video_url: str | None = None
    children: list[ChildDTO] = Field(default_factory=list)
