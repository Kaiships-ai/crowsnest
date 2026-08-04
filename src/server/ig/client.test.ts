import { beforeAll, describe, expect, test } from "vitest";

/**
 * `./client`'s header-building path now calls `getOrCreateServiceToken()`
 * (`@/server/secrets/store`), which imports `@/server/db` unconditionally at module
 * load and queries the `secrets` table. CROWSNEST_DB_PATH must be ":memory:" and
 * migrations must run before any dynamic `import("./client")` below, so that query has
 * a table to read (env fallback still supplies the token via IG_SERVICE_TOKEN, so no
 * row is ever written here) and the real on-disk db is never touched.
 */
beforeAll(async () => {
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  process.env.CROWSNEST_DB_PATH = ":memory:";
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
});

/**
 * These specs exist because of a real bug: the client originally did
 * `return (await res.json()) as T`, which type-checks perfectly and yields `undefined`
 * for every field at runtime. The sidecar speaks snake_case, and its profile DTO uses
 * entirely different names (`pk` / `username` / `full_name`) from the TypeScript
 * interface (`externalId` / `handle` / `displayName`).
 *
 * Every payload below is copied from the sidecar's actual pydantic DTOs in
 * `services/ig/crowsnest_ig/models.py` — not invented to match the mapper.
 */

const PROFILE_PAYLOAD = {
  pk: "1234567890",
  username: "kallaway",
  full_name: "Kallaway",
  biography: "storytelling",
  follower_count: 442288,
  following_count: 812,
  media_count: 1204,
  is_private: false,
  is_verified: true,
  profile_pic_url: "https://scontent.cdninstagram.com/v/t51/avatar.jpg",
  external_url: "https://kallaway.com",
  raw: { pk: "1234567890" },
};

const MEDIA_PAYLOAD = {
  pk: "3512345678901234567",
  code: "C8xYzAbCdEf",
  permalink: "https://www.instagram.com/reel/C8xYzAbCdEf/",
  taken_at: "2026-07-20T14:03:11+00:00",
  media_type: "video",
  product_type: "clips",
  caption: "designing a home",
  thumbnail_url: "https://scontent.cdninstagram.com/v/t51/thumb.jpg",
  video_url: "https://scontent.cdninstagram.com/v/t50/video.mp4",
  duration_sec: 41.5,
  view_count: 14_000_000,
  play_count: 14_500_000,
  like_count: 512_000,
  comment_count: 3_100,
  is_pinned: false,
  children: [],
  raw: { pk: "3512345678901234567" },
};

describe("mapProfile", () => {
  test("maps the sidecar's snake_case DTO onto the app's shape", async () => {
    const { mapProfile } = await import("./client");
    const p = mapProfile(PROFILE_PAYLOAD);

    expect(p.handle).toBe("@kallaway");
    expect(p.externalId).toBe("1234567890");
    expect(p.displayName).toBe("Kallaway");
    expect(p.followerCount).toBe(442288);
    expect(p.followingCount).toBe(812);
    expect(p.mediaCount).toBe(1204);
    expect(p.bio).toBe("storytelling");
    expect(p.isVerified).toBe(true);
    expect(p.isPrivate).toBe(false);
    expect(p.avatarUrl).toBe("https://scontent.cdninstagram.com/v/t51/avatar.jpg");
  });

  test("fails loudly when a required field is missing rather than yielding undefined", async () => {
    const { mapProfile } = await import("./client");
    const { IgError } = await import("./errors");

    const broken = { ...PROFILE_PAYLOAD, username: undefined };
    expect(() => mapProfile(broken)).toThrow(IgError);
    try {
      mapProfile(broken);
    } catch (err) {
      expect((err as InstanceType<typeof IgError>).code).toBe("IG_DRIFT");
    }
  });

  test("an undisclosed follower count is null — never the metric 0", async () => {
    const { mapProfile } = await import("./client");

    // The sidecar's ProfileDTO declares `follower_count: int | None`, so a null here is a
    // VALID payload meaning "Instagram didn't tell me". It used to become `0`, which was
    // then persisted onto `channels` and as a permanent point in the
    // `channel_snapshots` follower series, and refiled the channel into the `nano`
    // follower band — changing which posts the user sees in their own feed.
    const p = mapProfile({ ...PROFILE_PAYLOAD, follower_count: null });
    expect(p.followerCount).toBeNull();
    expect(p.followerCount).not.toBe(0);
  });

  test("a genuine zero follower count is kept — 0 is a real number of followers", async () => {
    const { mapProfile } = await import("./client");
    // Unlike view counts, where Instagram uses 0 to mean "withheld", a brand-new account
    // really can have zero followers. Only ABSENCE is unknown.
    expect(mapProfile({ ...PROFILE_PAYLOAD, follower_count: 0 }).followerCount).toBe(0);
  });

  test("a follower_count field that vanished from the contract is IG_DRIFT", async () => {
    const { mapProfile } = await import("./client");
    const { IgError } = await import("./errors");

    // FastAPI serialises nulls explicitly, so the key is always present unless the
    // sidecar contract actually changed. That case is real drift and must be loud —
    // every other required field already behaves this way.
    const renamed = { ...PROFILE_PAYLOAD } as Record<string, unknown>;
    delete renamed.follower_count;

    expect(() => mapProfile(renamed)).toThrow(IgError);
    try {
      mapProfile(renamed);
    } catch (err) {
      expect((err as InstanceType<typeof IgError>).code).toBe("IG_DRIFT");
      expect((err as InstanceType<typeof IgError>).detail.field).toBe("follower_count");
    }
  });

  test("tolerates new/unknown fields (private API drift is additive most of the time)", async () => {
    const { mapProfile } = await import("./client");
    const p = mapProfile({ ...PROFILE_PAYLOAD, some_new_field_meta_added: 42 });
    expect(p.handle).toBe("@kallaway");
  });

  test("absent optional fields become null, not undefined", async () => {
    const { mapProfile } = await import("./client");
    const p = mapProfile({ pk: "1", username: "x", follower_count: 0 });
    expect(p.displayName).toBeNull();
    expect(p.bio).toBeNull();
    expect(p.avatarUrl).toBeNull();
    expect(p.followerCount).toBe(0);
  });
});

describe("mapMedia", () => {
  test("maps a reel payload", async () => {
    const { mapMedia } = await import("./client");
    const m = mapMedia(MEDIA_PAYLOAD);

    expect(m.externalId).toBe("3512345678901234567");
    expect(m.shortcode).toBe("C8xYzAbCdEf");
    expect(m.mediaType).toBe("video");
    expect(m.productType).toBe("clips");
    expect(m.url).toBe("https://www.instagram.com/reel/C8xYzAbCdEf/");
    expect(m.takenAt).toBe("2026-07-20T14:03:11+00:00");
    expect(m.durationSec).toBe(41.5);
    expect(m.caption).toBe("designing a home");
    expect(m.likeCount).toBe(512_000);
    expect(m.commentCount).toBe(3_100);
  });

  test("prefers play_count over view_count so outlier maths uses one consistent number", async () => {
    const { mapMedia } = await import("./client");
    expect(mapMedia(MEDIA_PAYLOAD).viewCount).toBe(14_500_000);
    expect(mapMedia({ ...MEDIA_PAYLOAD, play_count: undefined }).viewCount).toBe(14_000_000);
    expect(mapMedia({ ...MEDIA_PAYLOAD, play_count: undefined, view_count: undefined }).viewCount).toBeNull();
  });

  test("treats a zero count as not disclosed, never as a real measurement", async () => {
    const { mapMedia } = await import("./client");

    // The listing endpoint sends play_count: 0 AND view_count: 0 on every row for media the
    // burner does not own. All 299 stored video payloads look like this. Taking either zero
    // literally once overwrote a genuine 2.27M-view reel with 0, and would drive every
    // outlier score to zero. Null instead means "ask the single-media endpoint", which does
    // carry the number. See docs/product/reel-view-count-spike.md.
    expect(mapMedia({ ...MEDIA_PAYLOAD, play_count: 0, view_count: 0 }).viewCount).toBeNull();

    // A zero in the preferred field must not shadow a real number in the fallback field.
    expect(mapMedia({ ...MEDIA_PAYLOAD, play_count: 0 }).viewCount).toBe(14_000_000);
    expect(mapMedia({ ...MEDIA_PAYLOAD, view_count: 0 }).viewCount).toBe(14_500_000);
  });

  test("maps carousel children with positions and per-child media types", async () => {
    const { mapMedia } = await import("./client");
    const m = mapMedia({
      ...MEDIA_PAYLOAD,
      media_type: "carousel",
      children: [
        { position: 0, pk: "c0", media_type: "photo", thumbnail_url: "https://cdn/0.jpg", video_url: null, raw: {} },
        { position: 1, pk: "c1", media_type: "video", thumbnail_url: "https://cdn/1.jpg", video_url: "https://cdn/1.mp4", raw: {} },
      ],
    });

    expect(m.mediaType).toBe("carousel");
    expect(m.children).toHaveLength(2);
    expect(m.children[0]).toMatchObject({ position: 0, externalId: "c0", mediaType: "photo" });
    expect(m.children[1]).toMatchObject({ position: 1, externalId: "c1", mediaType: "video", videoUrl: "https://cdn/1.mp4" });
  });

  test("throws IG_DRIFT on a missing required field", async () => {
    const { mapMedia } = await import("./client");
    const { IgError } = await import("./errors");
    for (const field of ["pk", "taken_at"]) {
      const broken: Record<string, unknown> = { ...MEDIA_PAYLOAD };
      delete broken[field];
      expect(() => mapMedia(broken), `missing ${field} must throw`).toThrow(IgError);
    }
  });

  test("throws IG_DRIFT on an unrecognised media_type instead of guessing", async () => {
    const { mapMedia } = await import("./client");
    expect(() => mapMedia({ ...MEDIA_PAYLOAD, media_type: "hologram" })).toThrow(/media_type/);
  });

  test("falls back to a permalink built from the shortcode when permalink is absent", async () => {
    const { mapMedia } = await import("./client");
    const m = mapMedia({ ...MEDIA_PAYLOAD, permalink: undefined });
    expect(m.url).toBe("https://www.instagram.com/p/C8xYzAbCdEf/");
  });
});

describe("health mapping", () => {
  test("reads the sidecar's snake_case health payload, including can_login", async () => {
    // Exercised through the client's own request path with a stubbed fetch, because
    // the health mapper is what Settings depends on to tell "no credentials" apart
    // from "logged out" — a distinction that silently broke when fields were cast.
    const payload = {
      status: "ok",
      logged_in: false,
      username: null,
      instagrapi_version: "2.18.9",
      session_loaded: false,
      session_path: "/x/data/ig-session.json",
      media_root: "/x/data/media",
      can_login: true,
      cooldown_until: null,
    };

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      const h = await igClient.health();
      expect(h.loggedIn).toBe(false);
      expect(h.instagrapiVersion).toBe("2.18.9");
      expect(h.sessionLoaded).toBe(false);
      expect(h.canLogin).toBe(true);
      expect(h.cooldownUntil).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a health response that dropped only logged_in is IG_DRIFT, not a signed-out user", async () => {
    // The dangerous direction: `bool(v) => v === true` turned an absent field into a
    // perfectly ordinary `false`, so "the sidecar stopped sending this" and "the user is
    // signed out" became the same value — and Settings would tell the user to reconnect
    // an account that is connected fine. `status` and `instagrapi_version` are untouched
    // here, which is exactly the shape the downstream guard in ig-actions cannot catch.
    const payload = {
      status: "ok",
      username: "kallaway",
      instagrapi_version: "2.18.9",
      session_loaded: true,
      session_path: "/x/data/ig-session.json",
      media_root: "/x/data/media",
      can_login: true,
      cooldown_until: null,
    };

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      const { IgError } = await import("./errors");
      const err = await igClient.health().then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(IgError);
      expect((err as InstanceType<typeof IgError>).code).toBe("IG_DRIFT");
      expect((err as InstanceType<typeof IgError>).detail.field).toBe("logged_in");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("every mandatory health boolean is guarded, not just logged_in", async () => {
    const complete = {
      status: "ok",
      logged_in: true,
      username: "kallaway",
      instagrapi_version: "2.18.9",
      session_loaded: true,
      session_path: "/x/data/ig-session.json",
      media_root: "/x/data/media",
      can_login: true,
      cooldown_until: null,
    };

    // `can_login` is what separates "no credentials yet" from "credentials present but
    // logged out" in Settings, and `session_loaded` drives the same screen. Both are
    // mandatory in HealthResponse and both collapse to a plausible false.
    const original = globalThis.fetch;
    try {
      for (const field of ["logged_in", "session_loaded", "can_login"] as const) {
        const partial = { ...complete } as Record<string, unknown>;
        delete partial[field];
        globalThis.fetch = (async () =>
          new Response(JSON.stringify(partial), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

        const { igClient } = await import("./client");
        const err = await igClient.health().then(
          () => null,
          (e: unknown) => e
        );
        expect((err as { code?: string } | null)?.code).toBe("IG_DRIFT");
        expect((err as { detail?: { field?: string } }).detail?.field).toBe(field);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a real signed-out sidecar still reports cleanly — false must stay false", async () => {
    // The guard must not turn a legitimate signed-out state into an error.
    const payload = {
      status: "ok",
      logged_in: false,
      username: null,
      instagrapi_version: "2.18.9",
      session_loaded: false,
      session_path: "/x/data/ig-session.json",
      media_root: "/x/data/media",
      can_login: false,
      cooldown_until: null,
    };

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      const h = await igClient.health();
      expect(h.loggedIn).toBe(false);
      expect(h.sessionLoaded).toBe(false);
      expect(h.canLogin).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a 401 from the sidecar is reported as a config fault, not an Instagram problem", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "invalid token" }), { status: 401, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      const { IgError } = await import("./errors");
      await expect(igClient.health()).rejects.toBeInstanceOf(IgError);
      await igClient.health().catch((err: unknown) => {
        expect((err as InstanceType<typeof IgError>).code).toBe("IG_SERVICE_UNAUTHORIZED");
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("an unreachable sidecar is IG_SERVICE_DOWN, never an empty result", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      await igClient.health().catch((err: unknown) => {
        expect((err as { code: string }).code).toBe("IG_SERVICE_DOWN");
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("medias page mapping", () => {
  test('stop_reason "page" means keep paginating, not stop', async () => {
    const payload = { items: [MEDIA_PAYLOAD], next_cursor: "CURSOR", stop_reason: "page" };
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      const { igClient } = await import("./client");
      const page = await igClient.medias({ handle: "@kallaway", sinceIso: "2026-06-26T00:00:00Z", maxItems: 200 });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe("CURSOR");
      expect(page.stopReason).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("real stop reasons survive the mapping", async () => {
    const original = globalThis.fetch;
    for (const reason of ["lookback", "cap", "exhausted"] as const) {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ items: [], next_cursor: null, stop_reason: reason }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
      const { igClient } = await import("./client");
      const page = await igClient.medias({ handle: "@x", sinceIso: "2026-06-26T00:00:00Z", maxItems: 10 });
      expect(page.stopReason).toBe(reason);
    }
    globalThis.fetch = original;
  });
});

describe("resolveMedia", () => {
  /** Copied from the sidecar's ResolveMediaResponse in `services/ig/crowsnest_ig/models.py`. */
  const RESOLVED = {
    pk: "3512345678901234567",
    media_type: "video",
    thumbnail_url: "https://scontent.cdninstagram.com/v/t51/fresh-thumb.jpg",
    video_url: "https://scontent.cdninstagram.com/v/t50/fresh-video.mp4",
    children: [],
    raw: {},
  };

  async function withPayload<T>(payload: unknown, fn: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  }

  test("returns the freshly-resolved URLs", async () => {
    const { igClient } = await import("./client");
    const m = await withPayload(RESOLVED, () => igClient.resolveMedia("3512345678901234567"));
    expect(m.externalId).toBe("3512345678901234567");
    expect(m.mediaType).toBe("video");
    expect(m.videoUrl).toBe("https://scontent.cdninstagram.com/v/t50/fresh-video.mp4");
    expect(m.thumbnailUrl).toBe("https://scontent.cdninstagram.com/v/t51/fresh-thumb.jpg");
  });

  test("a video with no video_url is IG_DRIFT, not a null the user sees as Instagram's fault", async () => {
    const { igClient } = await import("./client");
    const { IgError } = await import("./errors");

    // Returning a fresh video_url is this endpoint's entire purpose. Degrading to null
    // surfaced OUR mapper bug to the user as "Instagram did not return a video URL for
    // this post." — the only signal on that path, and it blames the wrong party.
    const err = await withPayload({ ...RESOLVED, video_url: null }, () =>
      igClient.resolveMedia("3512345678901234567").then(
        () => null,
        (e: unknown) => e
      )
    );

    expect(err).toBeInstanceOf(IgError);
    expect((err as InstanceType<typeof IgError>).code).toBe("IG_DRIFT");
    expect((err as InstanceType<typeof IgError>).detail.field).toBe("video_url");
  });

  test("a carousel with no video_url is fine — its videos live in children", async () => {
    const { igClient } = await import("./client");
    const m = await withPayload(
      {
        ...RESOLVED,
        media_type: "carousel",
        video_url: null,
        children: [{ position: 0, pk: "c0", media_type: "video", thumbnail_url: "https://cdn/0.jpg", video_url: "https://cdn/0.mp4", raw: {} }],
      },
      () => igClient.resolveMedia("3512345678901234567")
    );
    expect(m.videoUrl).toBeNull();
    expect(m.children[0].videoUrl).toBe("https://cdn/0.mp4");
  });

  test("the resolved shape carries no empty-string date or url to leak into videos", async () => {
    const { igClient } = await import("./client");
    const m = await withPayload(RESOLVED, () => igClient.resolveMedia("3512345678901234567"));

    // It used to return `IgMedia` with `takenAt: ""` and `url: ""`. `videos.posted_at` is
    // NOT NULL, and an empty string sorts before every real date — it would break the
    // lookback boundary and every date filter if such a value were ever persisted.
    expect("takenAt" in m).toBe(false);
    expect("url" in m).toBe(false);
  });
});

describe("fetchMediaStats", () => {
  /** Copied from the sidecar's MediaStatsResponse in `services/ig/crowsnest_ig/models.py`.
   *  The numbers are a real measurement: @jun_yuh reel 3953894690809843161, whose row in
   *  the dev db has view_count null because the listing endpoint reported play_count 0. */
  const STATS = {
    pk: "3953894690809843161",
    media_type: "video",
    product_type: "clips",
    play_count: 1_212_937,
    view_count: 0,
    like_count: 77_918,
    comment_count: 389,
  };

  async function withPayload<T>(payload: unknown, fn: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  }

  test("reads the play count the listing endpoint refused to give", async () => {
    const { igClient } = await import("./client");
    const s = await withPayload(STATS, () => igClient.fetchMediaStats("3953894690809843161"));

    // view_count is 0 here on purpose. Instagram returned 0 on the single-media call for
    // every reel measured during the spike, so play_count is the only field with signal.
    expect(s.viewCount).toBe(1_212_937);
    expect(s.externalId).toBe("3953894690809843161");
    expect(s.productType).toBe("clips");
    expect(s.likeCount).toBe(77_918);
  });

  test("applies the same zero-is-not-disclosed rule as mapMedia", async () => {
    const { igClient } = await import("./client");

    // Both values land in the same videos.view_count column and feed the same outlier
    // maths, so the two mappers must not disagree about what a zero means.
    const both = await withPayload({ ...STATS, play_count: 0, view_count: 0 }, () =>
      igClient.fetchMediaStats("3953894690809843161")
    );
    expect(both.viewCount).toBeNull();

    const fallback = await withPayload({ ...STATS, play_count: 0, view_count: 4_200 }, () =>
      igClient.fetchMediaStats("3953894690809843161")
    );
    expect(fallback.viewCount).toBe(4_200);
  });

  test("carries no takenAt or url that could reach upsertVideo", async () => {
    const { igClient } = await import("./client");
    const s = await withPayload(STATS, () => igClient.fetchMediaStats("3953894690809843161"));

    // Same hazard as IgResolvedMedia: videos.posted_at is NOT NULL, and an empty-string
    // date sorts before every real one, which would break the lookback boundary.
    expect("takenAt" in s).toBe(false);
    expect("url" in s).toBe(false);
  });
});
