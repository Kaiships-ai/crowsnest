"use client";

/**
 * The first-run flow (docs/product/v1-scope.md §2 "First run", §4 decision 1). Five
 * screens, not the prototype's six — signin is cut, its reasoning recorded in
 * `v1-scope.md`'s explicit-cuts table: the prototype's own Settings page says the
 * session lives in `.crowsnest/session.json` and re-auth happens in a terminal, which
 * cannot be true alongside a signin form with credential fields. Connect (this file's
 * `connect` step) is the one real credential moment, and it's a first-run screen because
 * nothing before this pass told Kai the sidecar has to be logged in before anything else
 * works.
 *
 * Deliberately its own top-level route (`src/app/first-run/`), not inside `(shell)`:
 * `(shell)/layout.tsx` renders the Sidebar, Topbar and failure strip — real-app chrome
 * that has nothing to orient here, and that layout's own route guard would otherwise
 * have to special-case its way around itself. This flow is a full-bleed two-column
 * screen like the prototype's own auth container, wired directly against the server
 * actions named in the ruling rather than a new one: `saveNicheSettingsAction`,
 * `igLoginAction` and its challenge/2FA branches, `addChannelAction`, `startSyncAction`.
 *
 * Step state lives here, in memory, not in the URL — nothing about "what step am I on"
 * needs to survive a reload independently of what's actually been saved server-side
 * (the niche, the Instagram session, the channels, the sync job all do that on their
 * own). A reload mid-flow re-lands on welcome, which just re-asks a question or two
 * whose answers are already persisted where they matter.
 *
 * The aside carries a persistent skip, because the sources step needs at least one real
 * handle before Continue lights up and someone who doesn't have one in hand otherwise has
 * nowhere to go. It has to write `first_run_completed` rather than just linking to `/`:
 * the shell's gate is `!firstRunCompleted && !hasChannels`
 * (`src/server/queries/first-run-gate.ts`), so on the zero-channel install this screen
 * exists for, a plain link would bounce straight back here. That is the same flag, written
 * through the same generic action, that the sync step's "Open Crowsnest" already sets.
 * Skipping loses nothing that was answered on the way through — the niche, the Instagram
 * session and any channels are each saved by their own step — and Settings' "Replay first
 * run" (`src/components/settings/onboarding-section.tsx`) clears the flag to come back.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateAppSettingsAction } from "@/server/actions/settings-actions";
import type { CreatorSeedRow } from "@/server/queries/discover";
import {
  canVerifyHandles,
  ONBOARDING_STEP_COUNT,
  ONBOARDING_STEPS,
  stepNavState,
  type IgStatusResult,
  type OnboardingStep,
} from "./onboarding-view";
import { WelcomeStep } from "./welcome-step";
import { FocusStep } from "./focus-step";
import { ConnectStep } from "./connect-step";
import { SourcesStep } from "./sources-step";
import { FirstSyncStep } from "./first-sync-step";

export interface OnboardingFlowProps {
  initialNiche: string;
  initialKeywords: string[];
  initialIgStatus: IgStatusResult;
  serviceUrl: string;
  seeds: CreatorSeedRow[];
}

export function OnboardingFlow({ initialNiche, initialKeywords, initialIgStatus, serviceUrl, seeds }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [niche, setNiche] = useState(initialNiche);
  const [igStatus, setIgStatus] = useState<IgStatusResult>(initialIgStatus);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [skipping, setSkipping] = useState(false);
  const currentStepMeta = ONBOARDING_STEPS.find((s) => s.key === step);

  function goTo(target: OnboardingStep) {
    if (stepNavState(step, target) === "locked") return;
    setStep(target);
  }

  // `skipping` is deliberately left true on the success path: the push away from this
  // route is what ends the pending state, so the button stays disabled instead of
  // flickering back to "Skip setup for now" while the navigation is still in flight.
  async function skipSetup() {
    setSkipping(true);
    const result = await updateAppSettingsAction({ firstRunCompleted: true });
    if (!result.ok) {
      setSkipping(false);
      toast.error(result.error);
      return;
    }
    router.push("/");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
      <aside className="relative flex flex-col overflow-hidden bg-card px-11 py-4 md:py-12">
        {/* The current step as an oversized, near-invisible readout — it fills the rail's
            negative space with instrument character instead of dead air, and it is the one
            place the step number gets to be large. Neutral, never amber (the score and one
            action own amber). Tuned for the fixed rail, so it has no place in the compact
            header below md. */}
        {currentStepMeta && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 bottom-28 hidden font-mono text-[11rem] leading-none font-semibold tracking-tighter tabular-nums text-foreground/[0.04] select-none md:block"
          >
            {currentStepMeta.n}
          </span>
        )}

        <span className="relative z-10 text-lg font-semibold tracking-tight">Crowsnest</span>

        {/* Narrow-only compact step indicator: below md the aside is a short header, not
            the fixed rail, so the full tagline and progress spine (below) give way to one
            line naming where the visitor is. Only for the numbered steps - the welcome
            screen's own body already carries the "N steps, about a minute" line, so
            repeating it in the header here would double it up on narrow. */}
        {step !== "welcome" && (
          <div className="relative z-10 mt-2 font-mono text-2xs tracking-wide text-faint md:hidden">
            {currentStepMeta?.label} · {currentStepMeta?.n} / {ONBOARDING_STEP_COUNT}
          </div>
        )}

        <div className="relative z-10 mt-16 hidden md:block">
          <p className="max-w-[15ch] text-xl leading-tight font-bold tracking-tight text-balance">
            Watch the channels you compete with.
          </p>
          <p className="mt-6 max-w-[34ch] text-sm leading-relaxed text-muted-foreground text-balance">
            Every post is scored against its own channel&apos;s median, so a nano account beating itself nine times
            over is as loud as a viral hit.
          </p>
        </div>

        {/* Progress spine + the way out, pinned to the base of the rail by mt-auto so the
            middle breathes instead of the old justify-between chasm. */}
        <div className="relative z-10 mt-auto flex flex-col items-start gap-10 pt-16">
          {step === "welcome" ? (
            <div className="hidden font-mono text-2xs tracking-wide text-faint md:block">
              {ONBOARDING_STEP_COUNT} steps · about a minute
            </div>
          ) : (
            <nav className="relative hidden flex-col md:flex" aria-label="First-run steps">
              {/* The rail: one hairline threading every tick, so the four steps read as a
                  single measured progression rather than four loose rows. */}
              <span aria-hidden className="absolute top-4 bottom-4 left-[7px] w-px bg-border" />
              {ONBOARDING_STEPS.map((s) => {
                const state = stepNavState(step, s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={state === "locked"}
                    aria-current={state === "current" ? "step" : undefined}
                    onClick={() => goTo(s.key)}
                    className="group relative flex items-center gap-3.5 py-2.5 text-left disabled:cursor-not-allowed"
                  >
                    {/* Square ticks, not dots: filled foreground for the current step, a
                        dimmer fill for a completed one, a hollow outline for what's ahead. */}
                    <span className="relative z-10 flex size-4 flex-none items-center justify-center bg-card">
                      <span
                        aria-hidden
                        className={
                          state === "current"
                            ? "size-2.5 bg-foreground"
                            : state === "done"
                              ? "size-2 bg-foreground/55"
                              : "size-2 border border-line-strong"
                        }
                      />
                    </span>
                    <span
                      className={`font-mono text-2xs tracking-wide ${state === "current" ? "text-foreground" : "text-faint"}`}
                    >
                      {s.n}
                    </span>
                    <span
                      className={`text-sm whitespace-nowrap transition-colors ${state === "current" ? "font-medium text-foreground" : state === "locked" ? "text-faint" : "text-muted-foreground group-hover:text-foreground"}`}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}

          <div>
            {/* Pulled left by the button's own horizontal padding so its label sits on the
                same line as the copy above it. */}
            <Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => void skipSetup()} disabled={skipping}>
              {skipping ? "Opening Crowsnest…" : "Skip setup for now"}
            </Button>
            <p className="mt-2 max-w-[30ch] text-xs leading-relaxed text-faint">
              Goes straight to the app. Anything you already answered is kept, and Settings can replay this.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 items-start px-8 pt-20 pb-16 sm:px-12 md:pt-28">
        {/* Keyed on the step so the panel replays one authored entrance — a short rise and
            fade from a visible resting state — each time the step changes. Reduced motion
            gets the content instantly, no movement. */}
        <div
          key={step}
          className="w-full max-w-[620px] duration-500 ease-out animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none"
        >
          {step === "welcome" && <WelcomeStep onGetStarted={() => setStep("focus")} />}

          {step === "focus" && (
            <FocusStep
              initialNiche={niche}
              initialKeywords={initialKeywords}
              onBack={() => setStep("welcome")}
              onContinue={(saved) => {
                setNiche(saved);
                setStep("connect");
              }}
            />
          )}

          {step === "connect" && (
            <ConnectStep
              initialStatus={initialIgStatus}
              serviceUrl={serviceUrl}
              onBack={() => setStep("focus")}
              onContinue={(status) => {
                // The status this step leaves with, not the page-load snapshot: someone
                // who connects (or whose sidecar comes up) during this step should have
                // sources reflect that immediately, not the stale answer from before they
                // acted.
                setIgStatus(status);
                setStep("sources");
              }}
            />
          )}

          {step === "sources" && (
            <SourcesStep
              niche={niche}
              seeds={seeds}
              canVerifyHandles={canVerifyHandles(igStatus)}
              onBack={() => setStep("connect")}
              onContinue={(ids) => {
                setChannelIds(ids);
                setStep("sync");
              }}
            />
          )}

          {step === "sync" && (
            <FirstSyncStep channelIds={channelIds} onOpenCrowsnest={() => router.push("/")} />
          )}
        </div>
      </div>
    </div>
  );
}
