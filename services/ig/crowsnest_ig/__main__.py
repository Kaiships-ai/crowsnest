"""Entry point: `uv run python -m crowsnest_ig`.

Config is validated before uvicorn is imported to bind anything, so a missing
IG_SERVICE_TOKEN kills the process with a clear message instead of starting a
half-configured listener.
"""

from __future__ import annotations

import sys

from .config import ConfigError, load_config
from .logging import configure, log_event


def main() -> int:
    configure()
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"crowsnest-ig: refusing to start: {exc}", file=sys.stderr)
        return 78  # EX_CONFIG

    import uvicorn

    from .app import create_app

    uvicorn.run(
        create_app(config),
        host=config.host,
        port=config.port,
        log_level="info",
        access_log=False,
    )
    log_event("service.exited")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
