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
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { getIgStatusAction } from "@/server/actions/ig-actions";
import { ONBOARDING_STEP_COUNT, ONBOARDING_STEPS, stepNavState, type OnboardingStep } from "./onboarding-view";
import { WelcomeStep } from "./welcome-step";
import { FocusStep } from "./focus-step";
import { ConnectStep } from "./connect-step";
import { SourcesStep } from "./sources-step";
import { FirstSyncStep } from "./first-sync-step";

type IgStatusResult = Awaited<ReturnType<typeof getIgStatusAction>>;

export interface OnboardingFlowProps {
  initialNiche: string;
  initialKeywords: string[];
  initialIgStatus: IgStatusResult;
  serviceUrl: string;
}

export function OnboardingFlow({ initialNiche, initialKeywords, initialIgStatus, serviceUrl }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [niche, setNiche] = useState(initialNiche);
  const [channelIds, setChannelIds] = useState<string[]>([]);

  function goTo(target: OnboardingStep) {
    if (stepNavState(step, target) === "locked") return;
    setStep(target);
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
      <aside className="flex flex-col justify-between gap-14 bg-card px-11 py-12">
        <span className="text-lg font-semibold tracking-tight">Crowsnest</span>

        <div>
          <p className="max-w-[15ch] text-xl leading-tight font-bold tracking-tight text-balance">
            Watch the channels you compete with.
          </p>
          <p className="mt-6 max-w-[34ch] text-sm leading-relaxed text-muted-foreground text-balance">
            Every post is scored against its own channel&apos;s median, so a nano account beating itself nine times
            over is as loud as a viral hit.
          </p>
        </div>

        {step === "welcome" ? (
          <div className="font-mono text-2xs tracking-wide text-faint">{ONBOARDING_STEP_COUNT} steps · about a minute</div>
        ) : (
          <nav className="flex flex-col gap-4" aria-label="First-run steps">
            {ONBOARDING_STEPS.map((s) => {
              const state = stepNavState(step, s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={state === "locked"}
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={() => goTo(s.key)}
                  className="flex items-center gap-3 text-left disabled:cursor-not-allowed"
                >
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-full ${state === "locked" ? "bg-muted" : "bg-foreground"}`}
                  />
                  <span
                    className={`font-mono text-2xs tracking-wide ${state === "current" ? "text-foreground" : "text-faint"}`}
                  >
                    {s.n}
                  </span>
                  <span
                    className={`text-sm whitespace-nowrap ${state === "current" ? "text-foreground" : state === "locked" ? "text-faint" : "text-muted-foreground"}`}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </aside>

      <div className="flex min-w-0 items-center px-8 py-16 sm:px-12">
        <div className="w-full max-w-[620px]">
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
              onContinue={() => setStep("sources")}
            />
          )}

          {step === "sources" && (
            <SourcesStep
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
