#!/usr/bin/env python3
"""
ig_publish.py - Instagram carousel publisher for /ksa:serve.

Uses the "Instagram API with Instagram Login" Content Publishing API
(host: graph.instagram.com). Reads credentials from the gitignored
.secrets/instagram.env so tokens live in ONE place.

Stdlib only (urllib) - no pip install needed.

Subcommands:
  publish  --caption-file FILE --images URL [URL ...]
  refresh  (refresh the 60-day long-lived token and rewrite it back to the env file)
  limit    (remaining API posts in the 24h window)

Security: never prints the token. Do not commit .secrets/.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API_VERSION = os.environ.get("IG_API_VERSION", "v23.0")
HOST = "https://graph.instagram.com"


def _find_env():
    """Walk up from this file to find .secrets/instagram.env (location-proof).
    Override with IG_ENV_PATH."""
    override = os.environ.get("IG_ENV_PATH")
    if override:
        return override
    d = os.path.dirname(os.path.abspath(__file__))
    while True:
        candidate = os.path.join(d, ".secrets", "instagram.env")
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(d)
        if parent == d:  # reached filesystem root
            return candidate  # return last guess; load_env will error clearly
        d = parent


ENV_PATH = _find_env()


def load_env(path=ENV_PATH):
    """Parse a simple KEY=VALUE env file. Returns a dict."""
    if not os.path.exists(path):
        sys.exit(f"ERROR: credentials file not found: {path}")
    env = {}
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    if not env.get("IG_ID") or not env.get("IG_LONG_LIVED_TOKEN"):
        sys.exit("ERROR: IG_ID and IG_LONG_LIVED_TOKEN must be set in the env file")
    return env


def _request(method, url, params):
    """Make an HTTP request. GET puts params in query, POST in body. Returns parsed JSON."""
    data = urllib.parse.urlencode(params).encode()
    if method == "GET":
        url = url + "?" + data.decode()
        req = urllib.request.Request(url, method="GET")
    else:
        req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        # Redact token if it ever appears in an echoed URL
        body = body.replace(params.get("access_token", "\0"), "<redacted>")
        sys.exit(f"ERROR: HTTP {e.code} from Instagram API: {body}")


def _create_image_container(ig_id, token, image_url):
    url = f"{HOST}/{API_VERSION}/{ig_id}/media"
    params = {
        "image_url": image_url,
        "is_carousel_item": "true",
        "access_token": token,
    }
    res = _request("POST", url, params)
    return res["id"]


def _create_carousel_container(ig_id, token, child_ids, caption):
    url = f"{HOST}/{API_VERSION}/{ig_id}/media"
    params = {
        "media_type": "CAROUSEL",
        "children": ",".join(child_ids),
        "access_token": token,
    }
    if caption:
        params["caption"] = caption
    res = _request("POST", url, params)
    return res["id"]


def _wait_finished(container_id, token, timeout=120):
    """Poll status_code until FINISHED (or fail). Returns when ready."""
    url = f"{HOST}/{API_VERSION}/{container_id}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = _request("GET", url, {"fields": "status_code", "access_token": token})
        status = res.get("status_code")
        if status == "FINISHED":
            return
        if status in ("ERROR", "EXPIRED"):
            sys.exit(f"ERROR: container {container_id} status={status}")
        time.sleep(3)
    sys.exit(f"ERROR: container {container_id} not FINISHED within {timeout}s")


def _publish(ig_id, token, creation_id):
    url = f"{HOST}/{API_VERSION}/{ig_id}/media_publish"
    res = _request("POST", url, {"creation_id": creation_id, "access_token": token})
    return res["id"]


def _permalink(media_id, token):
    url = f"{HOST}/{API_VERSION}/{media_id}"
    res = _request("GET", url, {"fields": "permalink", "access_token": token})
    return res.get("permalink", "")


def publish_carousel(image_urls, caption):
    """Publish a carousel. Returns (media_id, permalink)."""
    if not (2 <= len(image_urls) <= 10):
        sys.exit("ERROR: a carousel needs 2 to 10 images")
    env = load_env()
    ig_id, token = env["IG_ID"], env["IG_LONG_LIVED_TOKEN"]

    child_ids = [_create_image_container(ig_id, token, u) for u in image_urls]
    carousel_id = _create_carousel_container(ig_id, token, child_ids, caption)
    _wait_finished(carousel_id, token)
    media_id = _publish(ig_id, token, carousel_id)
    return media_id, _permalink(media_id, token)


def publish_reel(video_url, caption, cover_url=None, share_to_feed=True):
    """Publish a single Reels video. Returns (media_id, permalink)."""
    env = load_env()
    ig_id, token = env["IG_ID"], env["IG_LONG_LIVED_TOKEN"]

    url = f"{HOST}/{API_VERSION}/{ig_id}/media"
    params = {
        "media_type": "REELS",
        "video_url": video_url,
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": token,
    }
    if caption:
        params["caption"] = caption
    if cover_url:
        params["cover_url"] = cover_url
    res = _request("POST", url, params)
    container_id = res["id"]

    # Video processing is slower than images - poll up to ~6 min.
    _wait_finished(container_id, token, timeout=360)
    media_id = _publish(ig_id, token, container_id)
    return media_id, _permalink(media_id, token)


def refresh_token():
    """Refresh the 60-day long-lived token and rewrite it into the env file."""
    env = load_env()
    url = f"{HOST}/refresh_access_token"
    res = _request("GET", url, {
        "grant_type": "ig_refresh_token",
        "access_token": env["IG_LONG_LIVED_TOKEN"],
    })
    new_token = res.get("access_token")
    if not new_token:
        sys.exit("ERROR: no access_token in refresh response")
    # Rewrite the env file, replacing only the token line.
    with open(ENV_PATH, "r") as f:
        lines = f.readlines()
    with open(ENV_PATH, "w") as f:
        for line in lines:
            if line.startswith("IG_LONG_LIVED_TOKEN="):
                f.write(f"IG_LONG_LIVED_TOKEN={new_token}\n")
            else:
                f.write(line)
    print(f"OK: token refreshed, expires_in={res.get('expires_in')}s")


def check_limit():
    env = load_env()
    url = f"{HOST}/{API_VERSION}/{env['IG_ID']}/content_publishing_limit"
    res = _request("GET", url, {"fields": "quota_usage,config", "access_token": env["IG_LONG_LIVED_TOKEN"]})
    print(json.dumps(res, indent=2))


def main():
    p = argparse.ArgumentParser(description="Instagram carousel publisher")
    sub = p.add_subparsers(dest="cmd", required=True)

    pub = sub.add_parser("publish", help="publish a carousel")
    pub.add_argument("--caption-file", help="path to a file with the caption")
    pub.add_argument("--caption", help="caption text (overridden by --caption-file)")
    pub.add_argument("--images", nargs="+", required=True, help="public JPEG URLs, in order")

    reel = sub.add_parser("publish-reel", help="publish a single Reels video")
    reel.add_argument("--caption-file", help="path to a file with the caption")
    reel.add_argument("--caption", help="caption text (overridden by --caption-file)")
    reel.add_argument("--video", required=True, help="public mp4 URL")
    reel.add_argument("--cover", help="public JPEG URL for the cover (optional)")

    sub.add_parser("refresh", help="refresh the long-lived token")
    sub.add_parser("limit", help="show remaining publish quota")

    args = p.parse_args()

    def _caption(a):
        c = a.caption or ""
        if a.caption_file:
            with open(a.caption_file, "r") as f:
                c = f.read().strip()
        return c

    if args.cmd == "publish":
        media_id, permalink = publish_carousel(args.images, _caption(args))
        print(json.dumps({"media_id": media_id, "permalink": permalink}, indent=2))
    elif args.cmd == "publish-reel":
        media_id, permalink = publish_reel(args.video, _caption(args), args.cover)
        print(json.dumps({"media_id": media_id, "permalink": permalink}, indent=2))
    elif args.cmd == "refresh":
        refresh_token()
    elif args.cmd == "limit":
        check_limit()


if __name__ == "__main__":
    main()
