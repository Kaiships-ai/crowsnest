"use client";

/**
 * The Ideas inbox's keyboard command menu (Task 11, spec §U5): a small reference/action
 * popover, opened by `K`, listing the shortcuts that already work on the selected idea
 * (`idea-inbox.tsx`'s own `keydown` handler fires them whether or not this is open — this
 * is the cheat sheet, not a second dispatcher). Each row is also clickable, so the same
 * five actions work for a mouse.
 *
 * Two rows the spec names — "Add to project" and "Save hook template" — have no backing
 * feature yet (no project entity, no hook-template save path off an idea), so they are
 * simply absent from `ROWS` rather than rendered disabled. A row that's visible but
 * inert invites a bug report; a row that doesn't exist yet doesn't.
 *
 * Amber law: this is a reference list, not a verdict on any idea, so none of it is
 * amber. Surface is `--popover` (DESIGN-SYSTEM.md's hover/overlay token), the hovered or
 * keyboard-focused row is `--card` (the same neutral "this one's active" treatment the
 * inbox's own selected list row and selected tab already use), and the `<kbd>` hints are
 * plain neutral ink.
 */

export type IdeaCommandAction = "create-script" | "shortlist" | "export" | "open" | "discard";

const ROWS: { key: string; label: string; action: IdeaCommandAction }[] = [
  { key: "C", label: "Create script", action: "create-script" },
  { key: "S", label: "Shortlist", action: "shortlist" },
  { key: "E", label: "Export for LLM", action: "export" },
  { key: "O", label: "Open in new tab", action: "open" },
  { key: "D", label: "Discard", action: "discard" },
];

export function IdeaCommandMenu({
  onAction,
  onClose,
}: {
  onAction: (action: IdeaCommandAction) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Idea actions"
      className="fixed right-6 bottom-6 z-50 flex w-64 flex-col border border-border bg-popover text-popover-foreground shadow-md"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Idea actions</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close command menu"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Esc
        </button>
      </div>
      {ROWS.map((row) => (
        <button
          key={row.action}
          type="button"
          role="menuitem"
          onClick={() => {
            onAction(row.action);
            onClose();
          }}
          className="flex items-center justify-between px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-card focus-visible:bg-card focus-visible:outline-none"
        >
          <span>{row.label}</span>
          <kbd className="border border-border bg-transparent px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            {row.key}
          </kbd>
        </button>
      ))}
    </div>
  );
}
