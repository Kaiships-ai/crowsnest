"use client";

import { Button } from "@/components/ui/button";
import { ONBOARDING_STEP_COUNT } from "./onboarding-view";

// One line per step, and the count is read from ONBOARDING_STEPS rather than written
// here, so the copy and the flow cannot drift. They had: this list merged choosing
// channels with running the first sync, so the screen promised four steps and showed
// three.
const POINTS = [
  "Pick what you make, so the scoring starts from your niche.",
  "Connect the Instagram account the sidecar signs in with. Read only, nothing is posted.",
  "Type in the channels to watch — there's no suggestion list, so bring their handles.",
  "Run the first sync, and see what beat its own median.",
];

export function WelcomeStep({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div>
      <span className="font-mono text-2xs tracking-wide text-faint">WELCOME</span>
      <h1 className="mt-4 max-w-[20ch] text-xl leading-tight font-bold tracking-tight text-balance">
        Find the posts worth copying
      </h1>
      <p className="mt-5 max-w-[46ch] text-sm leading-relaxed text-muted-foreground text-balance">
        Crowsnest watches a handful of Instagram channels and scores every post against that channel&apos;s own
        median, so you see what over-performed, not just what is popular.
      </p>

      <div className="mt-10 flex max-w-[460px] flex-col">
        {POINTS.map((text, i) => (
          <div key={text} className="flex items-baseline gap-4 border-b border-border py-3.5">
            <span className="w-6 flex-none font-mono text-2xs tracking-wide text-faint">{`0${i + 1}`}</span>
            <span className="text-sm leading-relaxed text-muted-foreground">{text}</span>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-7">
        <Button onClick={onGetStarted}>Get started</Button>
        <span className="font-mono text-xs text-faint">{ONBOARDING_STEP_COUNT} steps · about a minute</span>
      </div>
    </div>
  );
}
