import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/first-run/onboarding-flow";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { getNicheSettings } from "@/server/actions/settings-actions";
import { config } from "@/server/config";
import { listCreatorSeeds } from "@/server/queries/discover";
import { getSettings } from "@/server/settings";

// Reads live app_settings / sidecar state on every visit — no dynamic segment or
// searchParams here to implicitly opt this route out of static rendering otherwise
// (same reasoning as (shell)/page.tsx and (shell)/layout.tsx's own force-dynamic).
export const dynamic = "force-dynamic";

/**
 * Top-level route, deliberately outside `(shell)` — see `onboarding-flow.tsx`'s module
 * doc for why. `(shell)/layout.tsx` redirects a fresh install here; this page is the
 * other half of that gate: someone who has already finished first run and navigates to
 * `/first-run` directly (a bookmark, a stale tab, typing the URL) is sent straight back
 * to the dashboard rather than being dropped into a flow that would just re-run steps
 * whose answers are already saved. The only supported way to see this screen again after
 * completion is the Settings control that clears `first_run_completed` first.
 */
export default async function FirstRunPage() {
  const settings = await getSettings();
  if (settings.firstRunCompleted) redirect("/");

  const [nicheSettings, igStatus, seeds] = await Promise.all([
    getNicheSettings(),
    getIgStatusAction(),
    listCreatorSeeds(),
  ]);

  return (
    <OnboardingFlow
      initialNiche={nicheSettings.niche}
      initialKeywords={nicheSettings.keywords}
      initialIgStatus={igStatus}
      serviceUrl={config.IG_SERVICE_URL}
      seeds={seeds}
    />
  );
}
