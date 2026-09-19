import { PageContainer } from "@/components/layout/page-container";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountsSection } from "@/components/settings/accounts-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { FeedDefaultsSection } from "@/components/settings/feed-defaults-section";
import { GraphSection } from "@/components/settings/graph-section";
import { InstagramSection } from "@/components/settings/instagram-section";
import { LocalBinariesSection, type BinaryStatus } from "@/components/settings/local-binaries-section";
import { NicheProfileSection } from "@/components/settings/niche-profile-section";
import { OnboardingSection } from "@/components/settings/onboarding-section";
import { RouterSection } from "@/components/settings/router-section";
import { RunsAlertsSection } from "@/components/settings/runs-alerts-section";
import { ScoringSection } from "@/components/settings/scoring-section";
import { SecretsSection } from "@/components/settings/secrets-section";
import { SettingsNav, type SettingsNavGroup } from "@/components/settings/settings-nav";
import { listAccounts } from "@/server/services/accounts";
import { SyncSection, type LastSyncJobResult } from "@/components/settings/sync-section";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { getRouterStatusAction } from "@/server/actions/router-actions";
import { getAppSettingsAction, getNicheSettings } from "@/server/actions/settings-actions";
import { getLatestSyncJob } from "@/server/actions/sync-actions";
import { config } from "@/server/config";
import { detectBinary } from "@/server/lib/exec";
import { secretStatus } from "@/server/secrets/store";
import { whisperAvailability } from "@/server/transcribe/whispercpp";

// Anchors for SettingsNav, grouped to match the main sidebar's own grouped model.
// Group order here is the order the sections appear on the page below, so the two
// never drift out of sync with each other.
const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "Connections",
    items: [
      { id: "instagram", label: "Instagram" },
      { id: "accounts", label: "Accounts" },
      { id: "graph-api", label: "Graph API" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "niche-profile", label: "Niche profile" },
      { id: "scoring", label: "Scoring" },
      { id: "feed-defaults", label: "Feed defaults" },
    ],
  },
  {
    label: "Generation",
    items: [
      { id: "api-keys", label: "API keys" },
      { id: "router", label: "9router" },
      { id: "local-binaries", label: "Local binaries" },
    ],
  },
  {
    label: "Sync",
    items: [
      { id: "sync", label: "Sync" },
      { id: "runs-alerts", label: "Runs and alerts" },
    ],
  },
  {
    label: "Publish",
    items: [{ id: "publish", label: "Publish" }],
  },
  {
    label: "System",
    items: [
      { id: "onboarding", label: "Onboarding" },
      { id: "appearance", label: "Appearance" },
    ],
  },
];

// Reads live process.env / filesystem / DB state on every load — no dynamic segment
// or searchParams to implicitly opt this route out of static rendering otherwise
// (same reasoning as (shell)/page.tsx's Dashboard).
export const dynamic = "force-dynamic";

// Topbar already renders this route's h1 ("Settings") — see nav-items/topbar's
// ROUTE_TITLES — so page content here starts directly at the first section.
export default async function SettingsPage() {
  // The Instagram status is fetched here rather than in a mount effect, so the section
  // renders its real state on first paint (and so this repo's eslint set-state-in-effect
  // ban is satisfied by construction). `getIgStatusAction` never throws — an unreachable
  // sidecar arrives as an `ok: false` result the section renders as "service isn't
  // running", which is why this Promise.all can't take the whole page down with it.
  // `checkGraphTokenAction` is the same shape: documented to never throw, `ok: false`
  // here would mean the action itself broke, not "no token" (that's `state:
  // "not_configured"` inside an `ok: true` result).
  const [nicheSettings, ytdlpPath, whisper, igStatus, latestJob, appSettings, graphTokenResult, routerStatus] = await Promise.all([
    getNicheSettings(),
    detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp"),
    whisperAvailability(),
    getIgStatusAction(),
    getLatestSyncJob(),
    getAppSettingsAction(),
    checkGraphTokenAction(),
    getRouterStatusAction(),
  ]);

  // Sync, not part of the Promise.all above: `secretStatus()` reads the local sqlite
  // db directly (Task 1's store), the same way `config.ts` and every other server
  // module reads it, not through a server action's async RPC boundary.
  const secretStatuses = secretStatus();

  // Multi-account list (v0.3). A direct service read like secretStatus above, not a server
  // action, since this is a server component reading the local db.
  const accounts = await listAccounts();

  const binaries: BinaryStatus[] = [
    { label: "yt-dlp", available: ytdlpPath !== null, reason: ytdlpPath === null ? "not found on PATH" : undefined },
    { label: "whisper-cli (+ model)", available: whisper.available, reason: whisper.reason },
  ];

  // Passed through as a result, not flattened to `null`: a failed `sync_jobs` read is
  // rendered as a read failure, never as "no sync has run yet".
  const lastJob: LastSyncJobResult = latestJob.ok ? { ok: true, job: latestJob.job } : { ok: false, error: latestJob.error };

  const graphStatus = graphTokenResult.ok
    ? graphTokenResult.status
    : { configured: false, username: null, state: "unknown" as const, message: graphTokenResult.error, checkedAt: new Date().toISOString() };

  return (
    <PageContainer className="flex flex-col gap-6 lg:flex-row lg:gap-10">
      <SettingsNav groups={SETTINGS_NAV_GROUPS} />

      {/* min-w-0 so the sections beside a flex sibling (the nav) can still shrink/wrap
          instead of pushing the nav out of the sticky column it needs to stay in.
          Every section is a Card now, so the group rhythm is gap, not a border-b rule
          between full-bleed blocks. */}
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[0].label}</p>
          <div id="instagram" className="scroll-mt-6">
            <InstagramSection initialStatus={igStatus} serviceUrl={config.IG_SERVICE_URL} />
          </div>
          <div id="accounts" className="scroll-mt-6">
            <AccountsSection initialAccounts={accounts} />
          </div>
          <div id="graph-api" className="scroll-mt-6">
            <GraphSection initialStatus={graphStatus} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[1].label}</p>
          <div id="niche-profile" className="scroll-mt-6">
            <NicheProfileSection initialNiche={nicheSettings.niche} />
          </div>
          <div id="scoring" className="scroll-mt-6">
            <ScoringSection
              initial={{
                scoreBaselineMethod: appSettings.scoreBaselineMethod,
                scoreBaselineWindow: appSettings.scoreBaselineWindow,
                scoreMinUsablePosts: appSettings.scoreMinUsablePosts,
                scoreMinViewsFloor: appSettings.scoreMinViewsFloor,
              }}
            />
          </div>
          <div id="feed-defaults" className="scroll-mt-6">
            <FeedDefaultsSection
              initial={{
                feedDefaultMinScore: appSettings.feedDefaultMinScore,
                feedDefaultFollowerBand: appSettings.feedDefaultFollowerBand,
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[2].label}</p>
          <div id="api-keys" className="scroll-mt-6">
            <SecretsSection initialStatus={secretStatuses} />
          </div>
          <div id="router" className="scroll-mt-6">
            <RouterSection initialStatus={routerStatus} initialAutoManage={appSettings.routerAutoManage} />
          </div>
          <div id="local-binaries" className="scroll-mt-6">
            <LocalBinariesSection binaries={binaries} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[3].label}</p>
          <div id="sync" className="scroll-mt-6">
            <SyncSection
              config={{
                eagerVideoDownload: config.EAGER_VIDEO_DOWNLOAD,
                mediaRoot: config.MEDIA_ROOT,
              }}
              settings={{
                syncLookbackDays: appSettings.syncLookbackDays,
                maxItemsPerSync: appSettings.maxItemsPerSync,
                viewCountEnrichPerChannel: appSettings.viewCountEnrichPerChannel,
                syncCadenceMinutes: appSettings.syncCadenceMinutes,
                mediaRetentionDays: appSettings.mediaRetentionDays,
              }}
              scoreBaselineWindow={appSettings.scoreBaselineWindow.value}
              lastJob={lastJob}
            />
          </div>
          <div id="runs-alerts" className="scroll-mt-6">
            <RunsAlertsSection
              initial={{
                syncSlaMinutes: appSettings.syncSlaMinutes,
                remixSlaMinutes: appSettings.remixSlaMinutes,
                notifyOnSuccess: appSettings.notifyOnSuccess,
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[4].label}</p>
          <div id="publish" className="scroll-mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Publish</CardTitle>
                <CardDescription>
                  Scheduling and publishing settings appear here once that feature lands. Nothing to configure yet.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p data-lab className="font-mono text-2xs text-muted-foreground">{SETTINGS_NAV_GROUPS[5].label}</p>
          <div id="onboarding" className="scroll-mt-6">
            <OnboardingSection />
          </div>
          <div id="appearance" className="scroll-mt-6">
            <AppearanceSection />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
