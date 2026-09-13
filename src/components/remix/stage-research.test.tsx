/**
 * @vitest-environment jsdom
 *
 * B-02 regression: a failed research assembly must leave the skeleton for an error
 * and retry, not strand the stage on a permanent loader. `buildResearch` makes no
 * model call, but it still reads the db and can throw; when its action returns
 * `{ ok: false }` the stage has to surface that and offer a retry instead of
 * spinning the assembling skeleton forever.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { RemixSessionRow } from "@/server/services/remix";

const mocks = vi.hoisted(() => ({
  buildResearchAction: vi.fn(),
  updateStageAction: vi.fn(),
}));

vi.mock("@/server/actions/remix-actions", () => mocks);

import { StageResearch } from "./stage-research";

function session(overrides: Partial<RemixSessionRow> = {}): RemixSessionRow {
  return {
    id: "sess-1",
    sourceVideoId: "vid-1",
    stage: "research",
    topic: "a topic",
    niche: "fitness",
    targetLengthSec: 60,
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

beforeEach(() => {
  mocks.buildResearchAction.mockReset();
  mocks.updateStageAction.mockReset();
});

afterEach(() => {
  cleanup();
});

test("a failed research assembly leaves the skeleton for an error and retry", async () => {
  mocks.buildResearchAction.mockResolvedValue({ ok: false, error: "assembly failed" });

  await act(async () => {
    render(<StageResearch session={session()} vaultSavedPosts={[]} onNotesChange={vi.fn()} />);
  });

  // The stuck-skeleton bug: the assembling loader is still the only thing rendered.
  expect(screen.queryByText(/assembling research/i)).toBeNull();
  expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
});

test("a rejected research assembly (thrown, not returned ok:false) also leaves the skeleton for an error and retry", async () => {
  mocks.buildResearchAction.mockRejectedValue(new Error("boom before result could be built"));

  await act(async () => {
    render(<StageResearch session={session()} vaultSavedPosts={[]} onNotesChange={vi.fn()} />);
  });

  expect(screen.queryByText(/assembling research/i)).toBeNull();
  expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
});

test("retry re-runs the assembly and renders the notes on success", async () => {
  mocks.buildResearchAction.mockResolvedValueOnce({ ok: false, error: "assembly failed" });
  const onNotesChange = vi.fn();

  await act(async () => {
    render(<StageResearch session={session()} vaultSavedPosts={[]} onNotesChange={onNotesChange} />);
  });

  mocks.buildResearchAction.mockResolvedValueOnce({
    ok: true,
    notes: { sourceAnalysis: null, transcriptExcerpt: null, similar: [], facts: "" },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  });

  expect(mocks.buildResearchAction).toHaveBeenCalledTimes(2);
  expect(onNotesChange).toHaveBeenCalledWith({
    sourceAnalysis: null,
    transcriptExcerpt: null,
    similar: [],
    facts: "",
  });
});
