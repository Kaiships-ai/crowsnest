"""FastAPI surface. Localhost-only, shared-secret authenticated.

Every handler either returns a real result or raises an ``IgError`` that is
rendered as ``{"error": {...}}``. Nothing here converts a failure into an empty
list.
"""

from __future__ import annotations

import importlib.metadata as importlib_metadata
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import media as media_store
from .config import Config, load_config
from .errors import (
    IG_BAD_REQUEST,
    IG_INTERNAL,
    IG_ROUTE_NOT_FOUND,
    IG_UNAUTHORIZED,
    IgError,
    translate,
)
from .logging import configure, log_event
from .mapping import apply_lookback, children_from_media, media_to_dto, profile_to_dto
from .models import (
    ChallengeResolveRequest,
    DownloadRequest,
    DownloadResponse,
    HealthResponse,
    LoginRequest,
    LoginResponse,
    MediaStatsRequest,
    MediaStatsResponse,
    SessionImportRequest,
    MediasResponse,
    ProfileDTO,
    ResolveMediaRequest,
    ResolveMediaResponse,
    TwoFactorRequest,
)
from .session import SessionManager

_HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")

INSTAGRAPI_VERSION = importlib_metadata.version("instagrapi")

# instagrapi's page size for user_medias_paginated_v1.
DEFAULT_PAGE_SIZE = 33


def normalize_handle(raw: str) -> str:
    """Accept `@name` or `name`. Reject URLs and anything Instagram would not.

    A pasted profile URL is a real bug this repo has already shipped once; it is
    rejected here rather than silently prefixed with '@'.
    """
    handle = (raw or "").strip()
    if handle.startswith("@"):
        handle = handle[1:]
    handle = handle.strip().strip("/")
    if not handle:
        raise IgError(IG_BAD_REQUEST, "handle is required.")
    if not _HANDLE_RE.match(handle):
        raise IgError(
            IG_BAD_REQUEST,
            f"{raw!r} is not an Instagram handle "
            "(letters, digits, dots and underscores, max 30 chars).",
            detail={"handle": raw},
        )
    return handle.lower()


def parse_since(value: str | None) -> datetime | None:
    if value is None or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise IgError(
            IG_BAD_REQUEST,
            f"since_iso={value!r} is not an ISO-8601 timestamp.",
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def create_app(config: Config | None = None) -> FastAPI:
    configure()
    cfg = config or load_config()
    manager = SessionManager(cfg)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log_event(
            "service.starting",
            host=cfg.host,
            port=cfg.port,
            instagrapi=INSTAGRAPI_VERSION,
            session_path=str(cfg.session_path),
            media_root=str(cfg.media_root),
            can_login=cfg.can_login,
            proxy_configured=bool(cfg.proxy),
        )
        cfg.media_root.mkdir(parents=True, exist_ok=True)
        try:
            # Touch the client so the session blob is loaded (or its absence
            # logged) before the first request arrives.
            _ = manager.client
        except Exception as exc:  # noqa: BLE001 - health must still answer
            log_event(
                "service.client_init_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
        log_event("service.ready", logged_in=manager.logged_in())
        yield
        log_event("service.stopping")

    app = FastAPI(title="crowsnest-ig", version="0.1.0", lifespan=lifespan)
    app.state.config = cfg
    app.state.manager = manager

    def require_token(x_ig_token: str | None = Header(default=None)) -> None:
        if x_ig_token is None or not _constant_time_eq(x_ig_token, cfg.service_token):
            raise IgError(
                IG_UNAUTHORIZED,
                "Missing or invalid X-IG-Token header.",
            )

    @app.exception_handler(IgError)
    async def _ig_error_handler(_request: Request, exc: IgError) -> JSONResponse:
        log_event(
            "request.failed",
            code=exc.code,
            status=exc.status_code,
            error=exc.message,
            retryable=exc.retryable,
        )
        return JSONResponse(status_code=exc.status_code, content=exc.to_body())

    @app.exception_handler(Exception)
    async def _unexpected_handler(_request: Request, exc: Exception) -> JSONResponse:
        error = translate(exc)
        if error.code == IG_INTERNAL:
            log_event(
                "request.crashed",
                exception=type(exc).__name__,
                error=str(exc),
            )
        return JSONResponse(status_code=error.status_code, content=error.to_body())

    router = APIRouter(dependencies=[Depends(require_token)])

    # -- health ------------------------------------------------------------
    @app.get("/health", response_model=HealthResponse)
    def health(x_ig_token: str | None = Header(default=None)) -> HealthResponse:
        require_token(x_ig_token)
        return HealthResponse(
            status="ok",
            logged_in=manager.logged_in(),
            username=manager.username(),
            instagrapi_version=INSTAGRAPI_VERSION,
            session_loaded=manager.session_loaded,
            session_path=str(cfg.session_path),
            media_root=str(cfg.media_root),
            can_login=cfg.can_login,
            cooldown_until=manager.cooldown_until_iso(),
        )

    # -- auth --------------------------------------------------------------
    @router.post("/login", response_model=LoginResponse)
    def login(body: LoginRequest) -> LoginResponse:
        return LoginResponse(
            **manager.start_login(
                body.username, body.password, body.verification_code
            )
        )

    @router.post("/challenge/resolve", response_model=LoginResponse)
    def challenge_resolve(body: ChallengeResolveRequest) -> LoginResponse:
        return LoginResponse(**manager.resolve_challenge(body.choice, body.code))

    @router.post("/two-factor", response_model=LoginResponse)
    def two_factor(body: TwoFactorRequest) -> LoginResponse:
        return LoginResponse(**manager.complete_two_factor(body.code))

    @router.post("/login-by-session")
    def login_by_session(body: SessionImportRequest) -> dict[str, Any]:
        """Adopt a browser's existing session instead of authenticating.

        Escape hatch for the case where Instagram accepts the password in a browser
        but answers BadPassword to the private API (it distrusts the IP/device).
        Performs no password login, so it cannot contribute to the failed-login
        count that gets accounts checkpointed.
        """
        return manager.login_by_sessionid(body.sessionid)

    @router.post("/logout")
    def logout() -> dict[str, Any]:
        return manager.logout()

    # -- data --------------------------------------------------------------
    @router.get("/profile", response_model=ProfileDTO)
    def profile(handle: str = Query(...)) -> ProfileDTO:
        name = normalize_handle(handle)
        user = manager.call(
            "user_info_by_username",
            lambda client: client.user_info_by_username(name, use_cache=False),
        )
        return profile_to_dto(user.model_dump(mode="json"))

    @router.get("/medias", response_model=MediasResponse)
    def medias(
        handle: str = Query(...),
        since_iso: str | None = Query(default=None),
        max_items: int | None = Query(default=None, ge=1, le=1000),
        cursor: str | None = Query(default=None),
        already_kept: int = Query(default=0, ge=0),
        out_of_window_streak: int = Query(default=0, ge=0),
    ) -> MediasResponse:
        """One newest-first page, filtered against the lookback window.

        `already_kept` and `out_of_window_streak` are carried by the caller
        across pages so the 3-consecutive rule survives a page boundary; both
        default to 0 for a fresh walk.
        """
        name = normalize_handle(handle)
        since = parse_since(since_iso)

        user = manager.call(
            "user_info_by_username",
            lambda client: client.user_info_by_username(name, use_cache=True),
        )
        def _fetch_page(client: Any) -> tuple[Any, str, set[str]]:
            """Fetch a page AND the pin flags, which only exist in the raw payload.

            instagrapi's `Media` model drops Instagram's pin markers entirely, so
            mapping from `model_dump()` alone makes every post look unpinned. That
            is not cosmetic: a creator's pinned posts are returned FIRST and are
            arbitrarily old (@kallaway pins three, the newest from 2025), so a
            lookback walk reads them as "we've gone past the window" and stops
            before reaching a single recent post. Observed live: itemsSeen = 0 on a
            channel with 8 posts inside the window.

            The reliable per-item signal is a non-empty `timeline_pinned_user_ids`
            (it holds the owner's user id).
            """
            result, cursor_out = client.user_medias_paginated_v1(
                user.pk, amount=DEFAULT_PAGE_SIZE, end_cursor=cursor or ""
            )
            pinned: set[str] = set()
            last = client.last_json if isinstance(client.last_json, dict) else {}
            for item in last.get("items") or []:
                if item.get("timeline_pinned_user_ids") or item.get(
                    "clips_tab_pinned_user_ids"
                ):
                    pinned.add(str(item.get("pk")))
            for pk in last.get("pinned_profile_grid_items_ids") or []:
                pinned.add(str(pk))
            return result, cursor_out, pinned

        page, next_cursor, pinned_pks = manager.call(
            "user_medias_paginated_v1", _fetch_page
        )

        dtos = []
        for item in page:
            dto = media_to_dto(item.model_dump(mode="json"))
            if dto.pk in pinned_pks and not dto.is_pinned:
                dto = dto.model_copy(update={"is_pinned": True})
            dtos.append(dto)
        if pinned_pks:
            log_event("medias.pinned_detected", count=len(pinned_pks))
        kept, stop_reason, streak = apply_lookback(
            dtos,
            since=since,
            max_items=max_items,
            already_kept=already_kept,
            consecutive_out=out_of_window_streak,
        )

        if stop_reason == "page" and not next_cursor:
            stop_reason = "exhausted"
        if stop_reason in ("lookback", "cap", "exhausted"):
            next_cursor = None

        log_event(
            "medias.page",
            handle=name,
            fetched=len(dtos),
            kept=len(kept),
            stop_reason=stop_reason,
            has_next=bool(next_cursor),
            out_of_window_streak=streak,
        )
        return MediasResponse(
            items=kept,
            next_cursor=next_cursor or None,
            stop_reason=stop_reason,
        )

    @router.post("/resolve-media", response_model=ResolveMediaResponse)
    def resolve_media(body: ResolveMediaRequest) -> ResolveMediaResponse:
        pk = (body.pk or "").strip()
        if not pk:
            raise IgError(IG_BAD_REQUEST, "pk is required.")
        item = manager.call(
            "media_info",
            lambda client: client.media_info(pk, use_cache=False),
        )
        raw = item.model_dump(mode="json")
        dto = media_to_dto(raw)
        return ResolveMediaResponse(
            pk=dto.pk,
            media_type=dto.media_type,
            thumbnail_url=dto.thumbnail_url,
            video_url=dto.video_url,
            children=children_from_media(raw),
        )

    @router.post("/media-stats", response_model=MediaStatsResponse)
    def media_stats(body: MediaStatsRequest) -> MediaStatsResponse:
        """Fetch engagement counts for ONE media from the single-media endpoint.

        Deliberately calls ``media_info_v1`` rather than ``media_info``. The dispatcher
        would fall back to the public path on error, and that path was measured returning
        ``view_count: None`` and, when session-authenticated, HTML instead of JSON. We only
        want the route that actually carries the number.

        One pk per request, not a batch: the caller's HTTP timeout is 30s, and each of these
        is a live Instagram round trip that instagrapi may internally retry up to three
        times. Batching would put pacing on the wrong side of the timeout. The caller paces.
        """
        pk = (body.pk or "").strip()
        if not pk:
            raise IgError(IG_BAD_REQUEST, "pk is required.")
        item = manager.call(
            "media_stats",
            lambda client: client.media_info_v1(pk),
        )
        raw = item.model_dump(mode="json")
        dto = media_to_dto(raw)
        return MediaStatsResponse(
            pk=dto.pk,
            media_type=dto.media_type,
            product_type=dto.product_type,
            play_count=dto.play_count,
            view_count=dto.view_count,
            like_count=dto.like_count,
            comment_count=dto.comment_count,
        )

    @router.post("/download", response_model=DownloadResponse)
    def download(body: DownloadRequest) -> DownloadResponse:
        media_store.validate_url(body.url)
        client = manager.client
        result = media_store.download(
            body.url,
            media_root=cfg.media_root,
            timeout_s=cfg.download_timeout_s,
            user_agent=getattr(client, "user_agent", None),
            proxy=cfg.proxy,
        )
        log_event(
            "download.completed",
            kind=body.kind,
            media_pk=body.media_pk,
            sha256=result.sha256,
            bytes=result.bytes,
            deduped=result.deduped,
        )
        return result

    app.include_router(router)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(
        _request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        """Keep FastAPI's own 404/405 responses in the {"error": {...}} shape.

        A 404 arriving HERE is always a routing miss, never Instagram's answer about a
        media. Anything Instagram said travels as an ``IgError`` and is handled by
        ``_ig_error_handler`` above, which never reaches this function. So this 404 gets
        ``IG_ROUTE_NOT_FOUND``, not ``IG_NOT_FOUND``.

        That distinction is load bearing. Both are HTTP 404 and the bodies were previously
        identical, so a client calling a path this process does not serve got the same code
        it gets for a deleted post. A caller that reasonably skips past a deleted post then
        skips past every call in a batch, and reports a plausible-looking run of missing
        media instead of "the sidecar predates this endpoint". That happened: an enrichment
        pass hit a sidecar started two days before its route existed and reported three
        consecutive missing reels as a blocked account.
        """
        code = IG_ROUTE_NOT_FOUND if exc.status_code == 404 else IG_BAD_REQUEST
        error = IgError(
            code, str(exc.detail), status_code=exc.status_code, retryable=False
        )
        return JSONResponse(status_code=exc.status_code, content=error.to_body())

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        error = IgError(
            IG_BAD_REQUEST,
            "Request validation failed.",
            detail={"errors": exc.errors()},
        )
        return JSONResponse(status_code=error.status_code, content=error.to_body())

    return app


def _constant_time_eq(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
