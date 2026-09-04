"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IdeaCommandMenu, type IdeaCommandAction } from "@/components/ideas/command-menu";
import { formatCompact, formatEngagementRate, formatMultiplier, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildVideoPromptAction } from "@/server/actions/export-actions";
import { createScriptFromIdeaAction, setIdeaNotesAction, setIdeaStatusAction } from "@/server/actions/idea-actions";
import type { IdeaListItem, IdeaTab } from "@/server/queries/ideas";

const TABS: { value: IdeaTab; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "shortlist", label: "Shortlist" },
];

/** The score badge on an idea card/detail pane. Deliberately not `<OutlierBadge>` (the
 *  feed's own score badge): that component is a rounded pill, and DESIGN-SYSTEM.md §5
 *  puts radius 0 on badges — this is the one place that rule is actually followed to the
 *  letter. Amber wash/border/text per §3's amber law ("Score badge ... and the score
 *  gauge bar" is the one thing amber is for), and the word "score" rides inside the
 *  badge so the metric carries a text label rather than a bare number (§7 "Every metric
 *  has a text label ... `10.1x score`"). */
function ScoreBadge({ score }: { score: number | null }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center border border-score-line bg-score-wash px-2 py-0.5 font-mono text-2xs font-medium tabular-nums text-score">
      {formatMultiplier(score)} score
    </span>
  );
}

/** Views and engagement, neutral text with the metric's name spelled out — the same
 *  "text label, not an icon alone" rule as the score badge, but plain ink: amber is
 *  spent on the score alone (§3's amber law), never on a raw count. */
function NeutralMetrics({ item }: { item: IdeaListItem["post"] }) {
  return (
    <span className="text-2xs text-muted-foreground">
      {formatCompact(item.viewCount)} views · {formatEngagementRate(item.engagementRate)} engagement
    </span>
  );
}

function IdeaCard({
  idea,
  selected,
  onSelect,
}: {
  idea: IdeaListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-2 border-b border-border px-4 py-3 text-left transition-colors",
        // Selected mirrors the active-nav treatment (DESIGN-SYSTEM.md §3: "Active nav
        // item. Use --card background plus --foreground plus a 2px --line-strong bar on
        // the left") — a list row being "open" is the same concept as a rail item being
        // "current", so it earns the same visual rather than inventing a second one.
        selected
          ? "border-l-2 border-l-line-strong bg-card text-foreground"
          : "border-l-2 border-l-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground"
      )}
    >
      {/* Concept-first: the idea's own pitch leads, not the source post's caption
          (DESIGN-SYSTEM.md's concept-first rule) — one headline per card. */}
      <p className="line-clamp-2 text-[15px] font-medium text-foreground">{idea.concept}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={idea.scoreAtCreation} />
        <span className="truncate text-2xs text-faint">{idea.post.channel.handle}</span>
      </div>
      <NeutralMetrics item={idea.post} />
    </button>
  );
}

function EmptyPane({ tab }: { tab: IdeaTab }) {
  const copy =
    tab === "inbox"
      ? "No ideas in the inbox yet. Sync a channel, or generate one from an analyzed post."
      : "Nothing shortlisted yet. Shortlist an idea from the inbox to see it here.";
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-4 p-6">
      <p className="max-w-[46ch] text-sm text-muted-foreground">{copy}</p>
      <Link href="/feed" className="text-sm text-foreground underline underline-offset-4">
        Open the feed
      </Link>
    </div>
  );
}

/**
 * The Ideas inbox: Inbox/Shortlist tabs, a left list of concept-first cards, and a right
 * detail pane (concept, angle, source post, notes, and the Create script/Shortlist/
 * Discard action row). `items`/`tab` come from the server (`ideas/page.tsx`'s
 * `listIdeas`) — this component only navigates (tab switches re-fetch server-side) and
 * calls the two mutation actions; it holds no query of its own.
 */
export function IdeaInbox({ items, tab }: { items: IdeaListItem[]; tab: IdeaTab }) {
  const router = useRouter();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // A tab switch (new `items`) or an action that moves the picked idea out of the
  // current tab both leave `pickedId` pointing at a row that's no longer in the list —
  // derived here, during render, rather than synced back with a setState-in-effect: the
  // list's first row is the fallback the instant the pick goes stale, with no extra
  // render in between showing an empty detail pane.
  const selectedId = pickedId !== null && items.some((item) => item.id === pickedId) ? pickedId : (items[0]?.id ?? null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  function switchTab(next: IdeaTab) {
    router.push(`/ideas?tab=${next}`);
  }

  async function handleNotesBlur(id: string, value: string) {
    const result = await setIdeaNotesAction(id, value);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  // Wrapped in useCallback (deps: [tab, router]) rather than a plain function
  // declaration solely so runCommandAction/the keydown effect below can list it as a
  // dependency without that dependency's identity churning on every render — the
  // memoized identity is what keeps `useEffect`'s exhaustive-deps check satisfied
  // without re-subscribing the window listener on every keystroke elsewhere in the tree.
  const handleStatus = useCallback(
    async (idea: IdeaListItem, status: "shortlisted" | "discarded") => {
      setPending(idea.id);
      const result = await setIdeaStatusAction(idea.id, status);
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (status === "discarded") {
        // Discard is soft and reversible (idea.status stays a real, revertible column) —
        // the undo puts it straight back to the status it had in this tab, since that's
        // the only status this list ever shows before a discard.
        toast.success("Discarded", {
          action: {
            label: "Undo",
            onClick: async () => {
              const restored = await setIdeaStatusAction(idea.id, tab === "inbox" ? "inbox" : "shortlisted");
              if (!restored.ok) {
                toast.error(restored.error);
                return;
              }
              router.refresh();
            },
          },
        });
      } else {
        toast.success("Shortlisted");
      }
      router.refresh();
    },
    [tab, router]
  );

  const handleCreateScript = useCallback(
    async (idea: IdeaListItem) => {
      setPending(idea.id);
      const result = await createScriptFromIdeaAction(idea.id);
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Same destination the video detail's own Remix entry point uses — the seeded
      // session is looked up there by source video, not by session id, so there's no
      // separate "session detail" route to carry `result.sessionId` to.
      router.push(`/feed/${idea.sourceVideoId}/remix`);
    },
    [router]
  );

  /** Export for LLM: the idea has no export path of its own — it reuses the video
   *  detail's Copy-as-Prompt block (`buildVideoPromptAction`, Task 7) against the
   *  idea's `sourceVideoId`, so an idea and its source post always produce the exact
   *  same paste-ready markdown rather than a second, idea-specific export format. Same
   *  clipboard-write-can-reject handling and toast copy `video-detail.tsx`'s own
   *  `createPrompt` uses. */
  const handleExport = useCallback(async (idea: IdeaListItem) => {
    const result = await buildVideoPromptAction(idea.sourceVideoId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.prompt);
      toast.success("Prompt copied, paste into any LLM");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser permissions.");
    }
  }, []);

  // Shared by the letter-key shortcuts below and the command menu's own row clicks, so
  // "press E" and "click Export for LLM" can never drift into two different code paths.
  const runCommandAction = useCallback(
    (action: IdeaCommandAction, idea: IdeaListItem) => {
      switch (action) {
        case "create-script":
          handleCreateScript(idea);
          break;
        case "shortlist":
          handleStatus(idea, "shortlisted");
          break;
        case "discard":
          handleStatus(idea, "discarded");
          break;
        case "export":
          handleExport(idea);
          break;
        case "open":
          window.open(`/feed/${idea.sourceVideoId}`, "_blank", "noopener,noreferrer");
          break;
      }
    },
    [handleCreateScript, handleStatus, handleExport]
  );

  // The inbox's own keyboard command menu (Task 11): arrow up/down move the picked idea
  // through the list, Esc closes the reference popover, K opens it, and C/S/E/O/D fire
  // their action on whichever idea is currently selected — independent of whether the
  // popover is open, the same way Gmail's "c" composes without the cheat sheet showing.
  // Guarded first against a focused text input (the notes textarea) exactly the way
  // video-detail.tsx's own ArrowLeft/ArrowRight nav guards against it, so typing a note
  // never fires a shortcut mid-sentence.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (e.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        return;
      }
      if (e.key.toLowerCase() === "k") {
        setMenuOpen((prev) => !prev);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (items.length === 0) return;
        e.preventDefault();
        const currentIndex = items.findIndex((item) => item.id === selectedId);
        const base = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = e.key === "ArrowDown" ? Math.min(base + 1, items.length - 1) : Math.max(base - 1, 0);
        setPickedId(items[nextIndex].id);
        return;
      }

      const currentSelected = items.find((item) => item.id === selectedId) ?? null;
      if (!currentSelected) return;
      switch (e.key.toLowerCase()) {
        case "c":
          runCommandAction("create-script", currentSelected);
          break;
        case "s":
          runCommandAction("shortlist", currentSelected);
          break;
        case "e":
          runCommandAction("export", currentSelected);
          break;
        case "o":
          runCommandAction("open", currentSelected);
          break;
        case "d":
          runCommandAction("discard", currentSelected);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedId, menuOpen, runCommandAction]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => switchTab(t.value)}
            aria-current={tab === t.value ? "true" : undefined}
            className={cn(
              "px-3 py-2 text-sm transition-colors",
              // DESIGN-SYSTEM.md §3: "Selected toggle or segmented control. Use --card
              // plus --foreground." — never amber, so this can't reuse the primary button.
              tab === t.value
                ? "bg-card font-semibold text-foreground"
                : "font-normal text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-[520px] border border-border">
        <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-border">
          {items.length === 0 ? (
            <EmptyPane tab={tab} />
          ) : (
            items.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} selected={idea.id === selectedId} onSelect={() => setPickedId(idea.id)} />
            ))
          )}
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          {selected === null ? (
            <p className="text-sm text-muted-foreground">Select an idea to see its detail.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-medium text-foreground">{selected.concept}</h2>
                <p className="text-[15px] leading-relaxed text-muted-foreground">{selected.angle}</p>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground">Source post</p>
                <div className="flex flex-wrap items-center gap-2">
                  <ScoreBadge score={selected.post.outlierScore} />
                  <NeutralMetrics item={selected.post} />
                </div>
                <p className="line-clamp-3 text-sm text-foreground">{selected.post.caption ?? "—"}</p>
                <div className="flex items-center gap-2 text-2xs text-faint">
                  <span>{selected.post.channel.handle}</span>
                  <span aria-hidden>·</span>
                  <span>{relativeTime(selected.post.postedAt)}</span>
                  <Link href={`/feed/${selected.sourceVideoId}`} className="text-foreground underline underline-offset-4">
                    View post
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <label htmlFor="idea-notes" className="text-xs font-medium text-muted-foreground">
                  Your notes
                </label>
                <Textarea
                  id="idea-notes"
                  key={selected.id}
                  defaultValue={selected.notes ?? ""}
                  placeholder="Why this idea, what to change, anything worth remembering."
                  className="rounded-none"
                  onBlur={(e) => handleNotesBlur(selected.id, e.target.value)}
                />
              </div>

              <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
                {/* The one primary action per screen (DESIGN-SYSTEM.md §3) — amber, and
                    the only amber surface here besides the score badges. */}
                <Button
                  type="button"
                  disabled={pending === selected.id}
                  onClick={() => handleCreateScript(selected)}
                >
                  Create script
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending === selected.id}
                  onClick={() => handleStatus(selected, "shortlisted")}
                >
                  Shortlist
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending === selected.id}
                  onClick={() => handleStatus(selected, "discarded")}
                >
                  Discard
                </Button>
                {/* The only on-screen advertisement that the K command menu (Export for
                    LLM, Open in new tab, plus the three buttons above) exists at all —
                    neutral ink/border, same <kbd> treatment IdeaCommandMenu's own rows
                    use, so this never competes with the score badge for amber. Clicking
                    it opens the identical menu K does; it doesn't add a second path. */}
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-expanded={menuOpen}
                  className="ml-auto flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
                >
                  <kbd className="border border-border bg-transparent px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    K
                  </kbd>
                  Commands
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {menuOpen && selected !== null && (
        <IdeaCommandMenu
          onAction={(action) => runCommandAction(action, selected)}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
