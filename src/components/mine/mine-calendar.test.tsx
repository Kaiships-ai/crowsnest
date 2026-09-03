/**
 * @vitest-environment jsdom
 *
 * Declared per-file, same convention as logs-view.test.tsx. `@testing-library/jest-dom`
 * is not a dependency here, so `toBeTruthy()` stands in for `toBeInTheDocument()`, and
 * `@testing-library/user-event` is not installed either, so clicks and keys go through
 * `fireEvent`.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The component calls router.refresh() from its action handlers. Nothing in these tests
// reaches those, but useRouter itself throws outside a router context.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const { MineCalendar, detailPanelSide, NARROW_VIEWPORT } = await import("./mine-calendar");

const PLAN = {
  id: "plan-1",
  state: "scheduled" as const,
  title: "A planned cut",
  note: "only visible in the day detail",
  plannedDate: "2026-08-03",
  plannedTime: null,
  scriptId: null,
  scriptTitle: null,
  scriptLengthChars: null,
  scriptContent: null,
  scriptDetachedNote: null,
  remixSessionId: null,
  sourceVideoId: null,
  videoKind: null,
  targetLengthSec: null,
  publishedOwnPostId: null,
  reconciledOwnPostId: null,
  videoAssetId: null,
  caption: null,
  scheduledAt: null,
  attemptCount: 0,
  lastError: null,
  errorClass: null,
  publishedAt: null,
  dryRun: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderCalendar(plans: unknown[] = [PLAN]) {
  return render(
    <MineCalendar
      month="2026-08"
      calendar={{ month: "2026-08", published: [], plans, deadAir: [], measuredAt: null } as never}
      scripts={[]}
      graphConfigured={false}
      bucketConfigured={false}
      dryRun={true}
    />
  );
}

/** The August 2026 cell for the 3rd, which is the day PLAN sits on. */
function dayCell(): HTMLElement {
  const cells = screen.getAllByRole("button").filter((b) => b.textContent?.includes("A planned cut"));
  return cells[0];
}

afterEach(cleanup);

describe("detailPanelSide", () => {
  test("slides in from the right when there is room beside the grid", () => {
    expect(detailPanelSide(false)).toBe("right");
  });

  test("comes up from the bottom on a narrow viewport, where a side panel would cover the grid", () => {
    expect(detailPanelSide(true)).toBe("bottom");
  });

  test("the breakpoint is the one Tailwind's sm: starts at, so the panel and the grid agree", () => {
    expect(NARROW_VIEWPORT).toBe("(max-width: 639px)");
  });
});

describe("MineCalendar day detail", () => {
  test("the detail is closed until a cell is selected", () => {
    renderCalendar();
    expect(screen.queryByText("only visible in the day detail")).toBeNull();
  });

  test("selecting a cell opens the detail inside a dialog panel, and the grid stays on screen", async () => {
    renderCalendar();

    fireEvent.click(dayCell());
    const detail = await screen.findByText("only visible in the day detail");
    // The Sheet is a Base UI Dialog: the detail must be inside its popup, not appended
    // as a sibling of the grid the way it used to be.
    expect(detail.closest("[data-slot='sheet-content']")).not.toBeNull();
    // The grid is still there underneath, which is the whole point of a side panel.
    expect(screen.getByText("MON")).toBeTruthy();
  });

  test("Escape closes the detail, which the old inline block could not do", async () => {
    renderCalendar();

    fireEvent.click(dayCell());
    const detail = await screen.findByText("only visible in the day detail");

    fireEvent.keyDown(detail, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("only visible in the day detail")).toBeNull());
  });
});

describe("publish state cells (Goal 4)", () => {
  const base = { ...PLAN, note: null as string | null };

  test("a scheduled plan reads 'scheduled', neutral, with no amber", () => {
    renderCalendar([{ ...base, id: "p", state: "scheduled", scheduledAt: "2026-08-03T14:00:00.000Z" }]);
    const label = screen.getByTestId("mine-calendar-scheduled");
    expect(label.textContent).toBe("scheduled");
    expect(label.className).not.toMatch(/primary|amber/);
  });

  test("a publishing plan shows a neutral PUBLISHING mark, never amber", () => {
    renderCalendar([{ ...base, id: "p", state: "publishing" }]);
    const mark = screen.getByTestId("mine-calendar-publishing");
    expect(mark.textContent).toBe("PUBLISHING");
    expect(mark.className).not.toMatch(/primary|amber/);
    expect(mark.className).toContain("text-muted-foreground");
  });

  test("a failed plan shows its error class in a red (destructive), non-amber mark", () => {
    renderCalendar([{ ...base, id: "p", state: "failed", errorClass: "rate_limit", attemptCount: 1 }]);
    const mark = screen.getByTestId("mine-calendar-failed");
    expect(mark.textContent).toContain("rate_limit");
    expect(mark.className).toContain("text-destructive");
    expect(mark.className).not.toMatch(/primary|amber/);
  });

  test("a published plan shows a green (Verdict) check, never amber", () => {
    renderCalendar([{ ...base, id: "p", state: "published", publishedOwnPostId: "own-1" }]);
    const mark = screen.getByTestId("mine-calendar-published");
    expect(mark.textContent).toContain("published");
    expect(mark.className).toContain("text-pos");
    expect(mark.className).not.toMatch(/primary|amber/);
  });
});
