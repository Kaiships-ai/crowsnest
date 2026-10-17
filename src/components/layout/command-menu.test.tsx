/**
 * @vitest-environment jsdom
 *
 * Opening the palette crashed the page: CommandDialog rendered CommandInput with no
 * cmdk <Command> root, so cmdk's store context was undefined.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CommandMenu } from "@/components/layout/command-menu";
import { NAV_ITEMS } from "@/components/layout/nav-items";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

describe("CommandMenu", () => {
  test("Cmd+K opens the palette with its input and nav items, and selecting navigates", () => {
    render(<CommandMenu>page</CommandMenu>);
    act(() => {
      fireEvent.keyDown(document, { key: "k", metaKey: true });
    });
    expect(screen.getByPlaceholderText("Search… jump to a page")).toBeTruthy();
    const first = NAV_ITEMS[0];
    fireEvent.click(screen.getByText(first.label));
    expect(push).toHaveBeenCalledWith(first.href);
  });
});
