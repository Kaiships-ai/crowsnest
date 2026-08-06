"use client";

/**
 * Sticky sub-navigation down the left of the Settings page (prototype: settings.html's
 * `settingsNav` rail). The prototype swaps a single panel per tab; this page still
 * renders every section on one long scroll — see
 * docs/product/review-ui-gap-2026-07-31.md, Settings verdict PARTIAL, "Structure differs
 * a lot... the reviewer's noted cost is scrolling to find a setting." This closes that
 * gap without adopting the prototype's tab-swap model: nine sections is a lot of state
 * to hide behind a click, and every one of them already reads live system state on
 * load, so keeping them all mounted and just jumping between them costs nothing extra.
 *
 * Plain `<a href="#id">`, not `router.push` or scroll-driven client state: a hash link
 * is a real URL a bookmark or Cmd-click can reuse, and the browser's own back/forward
 * stack already does the right thing with it. Reimplementing either in React risks
 * breaking exactly the two things the brief calls out (deep links, the back button).
 * Active-section highlighting is pure decoration layered on top via
 * IntersectionObserver; it never drives navigation, so a jammed observer degrades to
 * "no item highlighted," never to "the link stopped working."
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  id: string;
  label: string;
}

/**
 * The one active section, given every section currently overlapping the observer's
 * band. Pure so the rule is testable without a scroll container (settings-nav.test.ts),
 * the same split `instagram-section.tsx`'s `viewStateOf` uses.
 *
 * Two sections overlap the band at every boundary — the band is a tenth of the
 * viewport tall and the observed elements are the full-height section blocks, not
 * their headers. The lower one wins: its top edge is what just crossed the reading
 * line, and it's the section filling the screen below. `previous` is kept when the
 * band is empty, so the highlight never blinks off between two short sections.
 */
export function activeSectionId(order: string[], visible: ReadonlySet<string>, previous: string): string {
  for (let i = order.length - 1; i >= 0; i--) {
    if (visible.has(order[i])) return order[i];
  }
  return previous;
}

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  // Seeded from the URL's own hash (if the page was opened as a deep link) rather than
  // always defaulting to the first item, so a reload of e.g. /settings#scoring shows
  // Scoring highlighted before the observer below has fired even once.
  const [activeId, setActiveId] = useState(() => {
    if (typeof window === "undefined") return items[0]?.id ?? "";
    const fromHash = window.location.hash.slice(1);
    return items.some((item) => item.id === fromHash) ? fromHash : (items[0]?.id ?? "");
  });

  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // `root: null` — the top-level viewport — is correct even though the page's real
    // scroll container is `<main>` (see (shell)/layout.tsx), not the window: a section
    // header's position relative to the viewport changes exactly the same whether it's
    // `main` or `window` doing the scrolling, since `main` fills the viewport. The
    // rootMargin trims that viewport to a thin band near the top, so "active" tracks
    // whichever section just crossed it rather than whichever happens to be tallest
    // on screen.
    // The observer reports only the sections whose intersection *changed*, so the
    // callback alone never sees the whole picture: a section that stayed in the band
    // is absent from the batch. Accumulating into this set is what makes the answer
    // depend on where the page is rather than on how it got there. The old code took
    // the last intersecting entry in the batch, which meant the same scroll position
    // highlighted a different section going up than going down (measured on
    // /settings: y=800 gave graph-api scrolling down, instagram scrolling up).
    const visible = new Set<string>();
    const order = sections.map((el) => el.id);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActiveId((previous) => activeSectionId(order, visible, previous));
      },
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="Settings sections" className="sticky top-6 flex w-44 shrink-0 flex-col gap-0.5 self-start">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "truncate rounded-sm px-3 py-2 text-sm transition-colors",
              isActive
                // Raised surface, never the amber `primary` token — same rule
                // sidebar.tsx's own nav active state follows, and amber on this screen
                // is reserved for exactly one control: the scoring save button, because
                // it rescores every post.
                ? "bg-popover font-semibold text-foreground"
                : "font-normal text-muted-foreground hover:bg-popover/60 hover:text-foreground"
            )}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
