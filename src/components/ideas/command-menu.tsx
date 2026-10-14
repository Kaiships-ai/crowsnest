"use client";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";

/**
 * The Ideas inbox's keyboard command menu (spec §U5): a small reference/action popover,
 * opened by `K`, listing the shortcuts that already work on the selected idea
 * (`idea-inbox.tsx`'s own `keydown` handler fires them whether or not this is open — this
 * is the cheat sheet, not a second dispatcher). Each row is also clickable, so the same
 * five actions work for a mouse.
 *
 * Two rows the spec names — "Add to project" and "Save hook template" — have no backing
 * feature yet (no project entity, no hook-template save path off an idea), so they are
 * simply absent from `ROWS` rather than rendered disabled. A row that's visible but
 * inert invites a bug report; a row that doesn't exist yet doesn't.
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
    <Card
      size="sm"
      role="menu"
      aria-label="Idea actions"
      className="fixed right-4 bottom-4 z-50 w-64 gap-0 shadow-md sm:right-6 sm:bottom-6"
    >
      <CardHeader className="border-b pb-3">
        <CardTitle className="text-sm text-muted-foreground">Idea actions</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close command menu">
            Esc
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-3">
        <ItemGroup>
          {ROWS.map((row) => (
            <Item
              key={row.action}
              size="xs"
              render={
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAction(row.action);
                    onClose();
                  }}
                />
              }
              className="text-left hover:bg-accent focus-visible:bg-accent"
            >
              <ItemContent>
                <ItemTitle>{row.label}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Kbd>{row.key}</Kbd>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
