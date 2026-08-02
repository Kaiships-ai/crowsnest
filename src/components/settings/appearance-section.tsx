"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

// No-op subscribe: this store never changes, it only tells the client apart from the
// server snapshot. useSyncExternalStore (not a mount effect) is the hydration-safe way
// to get that answer without a setState-in-effect call, which this repo's eslint config
// bans (see settings/page.tsx's dynamic export comment for the same rule).
function subscribe() {
  return () => {};
}

// Manual dark/light only, no system option, per the locked design. The control is a
// neutral radiogroup (raised surface marks the active option), never the amber primary
// token, matching settings-nav.tsx and sidebar.tsx: amber on this screen is reserved
// for the scoring save button.
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the resolved theme after mount (it reads localStorage on the
  // client). Rendering the active state before mount would mismatch the server HTML, so
  // nothing is marked active until mounted. The buttons still work on first click.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Theme for this workspace. Saved on this device.</p>
      </div>

      <div role="radiogroup" aria-label="Theme" className="flex w-fit gap-0.5">
        {THEME_OPTIONS.map((opt) => {
          const active = mounted && theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "rounded-sm px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-popover font-semibold text-foreground"
                  : "font-normal text-muted-foreground hover:bg-popover/60 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
