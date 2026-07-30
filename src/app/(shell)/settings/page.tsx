import { ApiKeyStatusCard } from "@/components/settings/api-key-status-card";
import { FeedDefaultsSection } from "@/components/settings/feed-defaults-section";
import { GraphSection } from "@/components/settings/graph-section";
import { InstagramSection } from "@/components/settings/instagram-section";
import { LocalBinariesSection, type BinaryStatus } from "@/components/settings/local-binaries-section";
import { NicheProfileSection } from "@/components/settings/niche-profile-section";
import { OnboardingSection } from "@/components/settings/onboarding-section";
import { ScoringSection } from "@/components/settings/scoring-section";
import { SyncSection, type LastSyncJobResult } from "@/components/settings/sync-section";
import { checkGraphTokenAction } from "@/server/actions/graph-actions";
import { getIgStatusAction } from "@/server/actions/ig-actions";
import { getAppSettingsAction, getNicheSettings, testAnthropicKeyAction } from "@/server/actions/settings-actions";
import { getLatestSyncJob } from "@/server/actions/sync-actions";
import { config } from "@/server/config";
import { detectBinary } from "@/server/lib/exec";
import { whisperAvailability } from "@/server/transcribe/whispercpp";

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
  const [nicheSettings, ytdlpPath, whisper, igStatus, latestJob, appSettings, graphTokenResult] = await Promise.all([
    getNicheSettings(),
    detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp"),
    whisperAvailability(),
    getIgStatusAction(),
    getLatestSyncJob(),
    getAppSettingsAction(),
    checkGraphTokenAction(),
  ]);

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
    <div className="mx-auto flex max-w-[1120px] flex-col p-6">
      <div className="border-b border-border pb-8">
        <NicheProfileSection initialNiche={nicheSettings.niche} initialKeywords={nicheSettings.keywords} />
      </div>

      <div className="border-b border-border py-8">
        <InstagramSection initialStatus={igStatus} serviceUrl={config.IG_SERVICE_URL} />
      </div>

      <div className="border-b border-border py-8">
        <GraphSection initialStatus={graphStatus} />
      </div>

      <section className="flex flex-col gap-3 border-b border-border py-8">
        <div>
          <h2 className="text-lg font-semibold">API keys</h2>
          <p className="text-sm text-muted-foreground">Keys live in .env.local. Restart the dev server after editing.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ApiKeyStatusCard
            label="Anthropic"
            envVar="ANTHROPIC_API_KEY"
            present={Boolean(process.env.ANTHROPIC_API_KEY)}
            onTest={testAnthropicKeyAction}
          />
          <ApiKeyStatusCard
            label="Groq"
            envVar="GROQ_API_KEY"
            present={Boolean(process.env.GROQ_API_KEY)}
            presenceOnlyHint="Verified on first transcribe"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Instagram credentials are deliberately not listed here: they live in the sidecar&apos;s own environment and are never read by this
          process. See the Instagram connection section above.
        </p>
      </section>

      <div className="border-b border-border py-8">
        <LocalBinariesSection binaries={binaries} />
      </div>

      <div className="border-b border-border py-8">
        <ScoringSection
          initial={{
            scoreBaselineMethod: appSettings.scoreBaselineMethod,
            scoreBaselineWindow: appSettings.scoreBaselineWindow,
            scoreMinUsablePosts: appSettings.scoreMinUsablePosts,
            scoreMinViewsFloor: appSettings.scoreMinViewsFloor,
          }}
        />
      </div>

      <div className="border-b border-border py-8">
        <FeedDefaultsSection
          initial={{
            feedDefaultMinScore: appSettings.feedDefaultMinScore,
            feedDefaultFollowerBand: appSettings.feedDefaultFollowerBand,
          }}
        />
      </div>

      <div className="border-b border-border py-8">
        <SyncSection
          config={{
            maxItemsPerSync: config.MAX_ITEMS_PER_SYNC,
            eagerVideoDownload: config.EAGER_VIDEO_DOWNLOAD,
            mediaRoot: config.MEDIA_ROOT,
          }}
          settings={{
            syncLookbackDays: appSettings.syncLookbackDays,
            syncCadenceMinutes: appSettings.syncCadenceMinutes,
            mediaRetentionDays: appSettings.mediaRetentionDays,
          }}
          lastJob={lastJob}
        />
      </div>

      <div className="pt-8">
        <OnboardingSection />
      </div>
    </div>
  );
}
