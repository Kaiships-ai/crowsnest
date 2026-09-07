/**
 * @vitest-environment jsdom
 *
 * llm BUG-01: `ReanalyzeButton` used to render live regardless of `hasKey`, unlike
 * `AnalysisGate`'s "Add your Claude API key" alert. Covers just the gate, via the
 * exported `ReanalyzeButton`, rather than mounting the whole data-heavy `VideoDetail`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/server/actions/analyze-actions", () => ({
  analyzeVideoAction: vi.fn(),
  reanalyzeVideoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ReanalyzeButton } from "./video-detail";

afterEach(cleanup);

describe("ReanalyzeButton", () => {
  test("with no Claude key, shows the disabled key-missing state instead of a live button", () => {
    render(<ReanalyzeButton videoId="v1" hasKey={false} />);
    const button = screen.getByRole("button", { name: "Re-analyze" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  test("with a key configured, renders a live enabled button", () => {
    render(<ReanalyzeButton videoId="v1" hasKey />);
    const button = screen.getByRole("button", { name: "Re-analyze" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
