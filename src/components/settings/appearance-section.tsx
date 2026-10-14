"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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

// Manual dark/light only, no system option, per the locked design. One exclusive choice,
// so a `ToggleGroup` named "Theme" rather than two buttons wired up as a radiogroup by
// hand. This build's group takes its value as an array (see `EnumField` in
// setting-field.tsx), so one selected theme is a one-element array.
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
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Theme for this workspace. Saved on this device.</CardDescription>
      </CardHeader>

      <CardContent>
        <ToggleGroup
          aria-label="Theme"
          value={mounted && theme ? [theme] : []}
          onValueChange={(vals: unknown[]) => {
            const next = vals[0] as string | undefined;
            if (next) setTheme(next);
          }}
        >
          {THEME_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value} size="sm">
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}
