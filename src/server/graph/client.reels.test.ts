import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Reels publish (B2: `createReelContainer` / `pollReelContainer` / `publishReel`).
 * Same dynamic-import-after-env-setup pattern as `client.test.ts` — see that file's
 * header comment for why: `../config` and `../secrets/store` both need env vars and a
 * migrated in-memory db in place before `./client` loads.
 */

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  delete process.env.IG_GRAPH_TOKEN;
  delete process.env.IG_GRAPH_USER_ID;
});

async function loadClient() {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  return import("./client");
}

function configureToken() {
  process.env.IG_GRAPH_TOKEN = "tok_secret";
  process.env.IG_GRAPH_USER_ID = "17841400000000000";
}

/** No real timer waits: the test always injects `sleep` so the poll loop advances
 *  instantly regardless of `maxAttempts`. */
const instantSleep = async () => {};

describe("Reels publish (container -> poll -> publish)", () => {
  test("happy path: container id, poll FINISHED, publish returns mediaId", async () => {
    configureToken();
    const fetchMock = vi
      .fn()
      // createReelContainer
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "container_1" }) })
      // pollReelContainer: one IN_PROGRESS, then FINISHED
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status_code: "IN_PROGRESS" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status_code: "FINISHED" }) })
      // publishReel
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "media_1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { createReelContainer, pollReelContainer, publishReel } = await loadClient();

    const { containerId } = await createReelContainer({ videoUrl: "https://example.com/reel.mp4", caption: "hi" });
    expect(containerId).toBe("container_1");

    const status = await pollReelContainer(containerId, { sleep: instantSleep });
    expect(status).toEqual({ status: "FINISHED" });

    const { mediaId } = await publishReel(containerId);
    expect(mediaId).toBe("media_1");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Container create + publish are POSTs against the ig-user-id edges.
    expect(String(fetchMock.mock.calls[0][0])).toContain("/17841400000000000/media");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[3][0])).toContain("/17841400000000000/media_publish");
    expect(fetchMock.mock.calls[3][1]?.method).toBe("POST");
  });

  test("poll returns ERROR -> throws GraphApiError with errorClass container", async () => {
    configureToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status_code: "ERROR" }) })
    );
    const { pollReelContainer } = await loadClient();
    const { GraphApiError } = await import("./errors");

    const promise = pollReelContainer("container_1", { sleep: instantSleep });
    await expect(promise).rejects.toBeInstanceOf(GraphApiError);
    await expect(promise).rejects.toMatchObject({ errorClass: "container", code: "GRAPH_CONTAINER_FAILED" });
  });

  test("no token configured -> throws with errorClass auth", async () => {
    // configureToken() deliberately not called: IG_GRAPH_TOKEN/USER_ID stay unset.
    const { createReelContainer } = await loadClient();

    await expect(createReelContainer({ videoUrl: "https://example.com/reel.mp4" })).rejects.toMatchObject({
      errorClass: "auth",
      code: "GRAPH_NOT_CONFIGURED",
    });
  });

  test("HTTP 401 from Instagram -> throws with errorClass auth", async () => {
    configureToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: "bad token", type: "OAuthException" } }) })
    );
    const { createReelContainer } = await loadClient();

    await expect(createReelContainer({ videoUrl: "https://example.com/reel.mp4" })).rejects.toMatchObject({
      errorClass: "auth",
      code: "GRAPH_AUTH_FAILED",
    });
  });

  test("a permanent Graph rejection (HTTP 400, code 100) is invalid_request, which publish never retries", async () => {
    configureToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 100, type: "OAuthException", message: "(#100) invalid video_url" } }) })
    );
    const { createReelContainer } = await loadClient();
    const { RETRYABLE_ERROR_CLASSES } = await import("@/server/services/publish-scheduler");
    const err = await createReelContainer({ videoUrl: "https://example.com/reel.mp4" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ errorClass: "invalid_request", code: "GRAPH_INVALID_REQUEST", retryable: false });
    expect(RETRYABLE_ERROR_CLASSES as readonly string[]).not.toContain((err as { errorClass: string }).errorClass);
  });

  test("poll never finishes within the attempt cap -> throws with errorClass timeout", async () => {
    configureToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status_code: "IN_PROGRESS" }) })
    );
    const { pollReelContainer } = await loadClient();

    await expect(pollReelContainer("container_1", { maxAttempts: 3, sleep: instantSleep })).rejects.toMatchObject({
      errorClass: "timeout",
      code: "GRAPH_TIMEOUT",
    });
  });
});
