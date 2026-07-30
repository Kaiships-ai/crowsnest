import { describe, expect, test } from "vitest";

/**
 * `runFramePassAction` is the honest "not yet analyzed" state from V1 data contracts,
 * contract 5 — there is no frame pass in this codebase (no image-input path on the LLM
 * client, no frame sampler), and the action must say so consistently rather than ever
 * fabricating a layout reading from the transcript. These specs pin that behaviour down
 * so a future change can't quietly start guessing.
 */
describe("runFramePassAction", () => {
  test("always fails with FRAME_NO_VISION_MODEL, regardless of the video id", async () => {
    const { runFramePassAction } = await import("./analyze-actions");

    const result = await runFramePassAction("some-video-id");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FRAME_NO_VISION_MODEL");
    expect(result.error.length).toBeGreaterThan(0);
  });

  test("never writes a layout row, even when force is requested", async () => {
    const { runFramePassAction } = await import("./analyze-actions");

    const result = await runFramePassAction("some-video-id", { force: true, maxFrames: 12 });

    // No `layout`, no `framesSampled`, no `frameModel` on a failure result — a partial
    // or guessed layout must never reach the caller from this action.
    expect(result.ok).toBe(false);
    expect("layout" in result).toBe(false);
  });

  test("an unknown video id gets the same honest answer, not a not-found error", async () => {
    // The action never reaches the database at all — the vision gate is upstream of
    // everything, including whether the video exists.
    const { runFramePassAction } = await import("./analyze-actions");

    const result = await runFramePassAction("does-not-exist");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FRAME_NO_VISION_MODEL");
  });
});
