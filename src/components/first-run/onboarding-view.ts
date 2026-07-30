/**
 * Pure step-ordering logic for the first-run flow, kept out of the JSX for the same
 * reason `sync-progress-view.ts` is: this repo's vitest runs in node with no jsdom, so a
 * plain function is what actually gets covered.
 *
 * Signin is cut (docs/product/v1-scope.md §4 decision 1) so there are five screens, not
 * six: an unnumbered welcome screen, then four numbered steps. The numbering in the
 * welcome copy and the left rail's step buttons must always agree with this list —
 * there is exactly one place that spells it out.
 */

export type OnboardingStep = "welcome" | "focus" | "connect" | "sources" | "sync";

export interface StepMeta {
  key: Exclude<OnboardingStep, "welcome">;
  n: string;
  label: string;
}

/** `01 FOCUS`, `02 INSTAGRAM`, `03 CHANNELS`, `04 FIRST SYNC` — the exact numbering the
 *  ruling calls for. */
export const ONBOARDING_STEPS: readonly StepMeta[] = [
  { key: "focus", n: "01", label: "FOCUS" },
  { key: "connect", n: "02", label: "INSTAGRAM" },
  { key: "sources", n: "03", label: "CHANNELS" },
  { key: "sync", n: "04", label: "FIRST SYNC" },
];

/** The welcome screen's "N steps" line reads off this length rather than a hardcoded
 *  word, so the copy cannot drift from the list above the way the prototype's own
 *  "five steps" line did the moment signin was cut. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

const ORDER: readonly OnboardingStep[] = ["welcome", "focus", "connect", "sources", "sync"];

export function stepIndex(step: OnboardingStep): number {
  return ORDER.indexOf(step);
}

export type StepNavState = "done" | "current" | "locked";

/** A step already passed is `done` (clickable, to go back), the step on screen is
 *  `current`, and anything later is `locked` — nothing past the current step is
 *  reachable by clicking ahead, only by completing what's in front of it. */
export function stepNavState(current: OnboardingStep, target: OnboardingStep): StepNavState {
  const c = stepIndex(current);
  const t = stepIndex(target);
  if (t < c) return "done";
  if (t === c) return "current";
  return "locked";
}
