/**
 * @vitest-environment jsdom
 *
 * A studio tab opened before an agent write must not overwrite that write on blur.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
});
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { db, newId, nowIso, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { getOrCreateSession, saveAgentScript, updateStage } from "@/server/services/remix";
import { StageScript } from "./stage-script";
import { StageStyle } from "./stage-style";

beforeAll(() => migrate());
afterEach(() => {
  cleanup();
  toastError.mockClear();
});

async function freshSession() {
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@stale-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `stale-${videoId}`,
    url: "https://example.com/source", caption: "topic", postedAt: now,
    durationSec: 30, viewCount: 1, outlierScore: 1, firstSeenAt: now,
  });
  return getOrCreateSession(videoId);
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

test("blurring a variant in a stale Script tab keeps the agent's variant and a valid pick", async () => {
  const created = await freshSession();
  await updateStage(created.id, { variants: ["A"], chosenVariantIndex: 0 });
  const stale = await getOrCreateSession(created.sourceVideoId);
  render(<StageScript session={stale} onVariantsChange={vi.fn()} onChosenVariantChange={vi.fn()} />);

  await saveAgentScript(created.id, "B", "agent");
  fireEvent.blur(screen.getByDisplayValue("A"));
  await settle();
  const unchanged = await getOrCreateSession(created.sourceVideoId);
  expect(unchanged.variants).toEqual(["A", "B"]);
  expect(unchanged.chosenVariantIndex).toBe(1);

  fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "A edited" } });
  fireEvent.blur(screen.getByDisplayValue("A edited"));
  await settle();
  const edited = await getOrCreateSession(created.sourceVideoId);
  expect(edited.variants).toEqual(["A edited", "B"]);
  expect(edited.chosenVariantIndex).toBe(1);
});

test("blurring a beat in a stale Style tab keeps the agent's outline", async () => {
  const created = await freshSession();
  await updateStage(created.id, { outline: { beats: [{ label: "Hook", content: "old", targetSec: 3 }] } });
  const stale = await getOrCreateSession(created.sourceVideoId);
  render(<StageStyle session={stale} vaultStyles={[]} onOutlineChange={vi.fn()} onStyleVaultItemChange={vi.fn()} />);

  const agentBeats = [
    { label: "Hook", content: "agent hook", targetSec: 3 },
    { label: "Body", content: "agent body", targetSec: 20 },
  ];
  await updateStage(created.id, { outline: { beats: agentBeats } });
  fireEvent.blur(screen.getByDisplayValue("Hook"));
  await settle();
  expect((await getOrCreateSession(created.sourceVideoId)).outline).toEqual({ beats: agentBeats });

  fireEvent.change(screen.getByDisplayValue("Hook"), { target: { value: "Opener" } });
  fireEvent.blur(screen.getByDisplayValue("Opener"));
  await settle();
  expect((await getOrCreateSession(created.sourceVideoId)).outline).toEqual({
    beats: [{ label: "Opener", content: "old", targetSec: 3 }, agentBeats[1]],
  });
});

test("a beat edit the server dropped shows a toast and is retried on the next blur", async () => {
  const created = await freshSession();
  const two = [
    { label: "Hook", content: "h", targetSec: 3 },
    { label: "Body", content: "b", targetSec: 20 },
  ];
  await updateStage(created.id, { outline: { beats: two } });
  const stale = await getOrCreateSession(created.sourceVideoId);
  render(<StageStyle session={stale} vaultStyles={[]} onOutlineChange={vi.fn()} onStyleVaultItemChange={vi.fn()} />);

  await updateStage(created.id, { outline: { beats: [two[0]] } });
  fireEvent.change(screen.getByDisplayValue("Body"), { target: { value: "Payoff" } });
  fireEvent.blur(screen.getByDisplayValue("Payoff"));
  await settle();
  expect(toastError).toHaveBeenCalled();
  expect((await getOrCreateSession(created.sourceVideoId)).outline).toEqual({ beats: [two[0]] });

  await updateStage(created.id, { outline: { beats: two } });
  fireEvent.blur(screen.getByDisplayValue("Payoff"));
  await settle();
  expect((await getOrCreateSession(created.sourceVideoId)).outline?.beats[1].label).toBe("Payoff");
});

test("a stale Script tab after an outline reset cannot store a pick or an edit", async () => {
  const created = await freshSession();
  await updateStage(created.id, { variants: ["A", "B"], chosenVariantIndex: 0 });
  const stale = await getOrCreateSession(created.sourceVideoId);
  const onVariantsChange = vi.fn();
  render(<StageScript session={stale} onVariantsChange={onVariantsChange} onChosenVariantChange={vi.fn()} />);

  await updateStage(created.id, { variants: [], chosenVariantIndex: null });
  fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "A edited" } });
  fireEvent.blur(screen.getByDisplayValue("A edited"));
  await settle();
  expect(toastError).toHaveBeenCalled();
  expect(onVariantsChange).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("tab", { name: "Variant 2" }));
  await settle();
  expect(toastError).toHaveBeenCalledTimes(2);
  const read = await getOrCreateSession(created.sourceVideoId);
  expect(read.variants).toEqual([]);
  expect(read.chosenVariantIndex).toBeNull();
});
