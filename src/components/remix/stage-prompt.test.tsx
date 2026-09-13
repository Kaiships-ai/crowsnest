/**
 * @vitest-environment jsdom
 *
 * B-11: Quick Remix must gate on the same proxy-availability signal
 * (remix-studio.tsx's `proxyDown`, sourced from run-log-view.ts's
 * `isProxyLikelyDown`) that Hook/Style/Script generation already use, instead of
 * only checking `hasLlmKey`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/server/actions/remix-actions", () => ({ updateStageAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import type { RemixSessionRow } from "@/server/services/remix";
import { StagePrompt } from "./stage-prompt";

function session(overrides: Partial<RemixSessionRow> = {}): RemixSessionRow {
  return {
    id: "s1",
    sourceVideoId: "v1",
    stage: "prompt",
    // Non-null so the prefill effect (autosave on mount) never fires here.
    topic: "already set topic",
    niche: "fitness",
    targetLengthSec: 45,
    researchNotes: null,
    hookOptions: null,
    chosenHook: null,
    styleVaultItemId: null,
    outline: null,
    variants: null,
    chosenVariantIndex: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("StagePrompt Quick Remix gate", () => {
  test("disables Quick Remix when the proxy is down, same as the other generation controls", () => {
    render(
      <StagePrompt
        session={session()}
        sourceTopic="source topic"
        niche="fitness"
        hasLlmKey={true}
        proxyDown={true}
        quickRemixPending={false}
        onUpdate={vi.fn()}
        onQuickRemix={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /Quick Remix/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("Quick Remix stays enabled once a key is set and the proxy is reachable", () => {
    render(
      <StagePrompt
        session={session()}
        sourceTopic="source topic"
        niche="fitness"
        hasLlmKey={true}
        proxyDown={false}
        quickRemixPending={false}
        onUpdate={vi.fn()}
        onQuickRemix={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /Quick Remix/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
